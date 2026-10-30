// Runs one task through a CLI agent: spawns the CLI, turns its JSON stream into step events, and returns the answer.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { BridgeError, CLI_RUNNERS, type CliRunner } from '../protocol';
import { claudeArgs, claudeMcpConfig, createClaudeParser } from './claude';
import { codexArgs, createCodexParser } from './codex';
import type { CliEvent, StreamParser } from './types';

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TASK_CHARS = 8000;
const STDERR_TAIL_CHARS = 2000;
/** Task ids become file names (`<taskId>.mcp.json`), so only letters, digits, `_` and `-` are allowed. */
export const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidTaskId(value: unknown): value is string {
  return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

export interface CliCommand {
  file: string;
  /** Arguments placed before the runner's own; used to run a script with node when a .cmd shim is found. */
  prefixArgs: string[];
}

export interface CliTaskInput {
  taskId: string;
  runner: CliRunner;
  task: string;
  tabId?: number;
}

export interface CliTaskResult {
  ok: boolean;
  text: string;
  error?: string;
}

export type CliStepEmitter = (taskId: string, state: string, details: string) => void;

/** A run only succeeds with a final answer: a CLI that exits cleanly without one has failed the task. */
function requireFinalAnswer(result: CliTaskResult, lastFailure: string | null): CliTaskResult {
  if (!result.ok || result.text.trim()) return result;
  const detail = lastFailure ? `; last failed step: ${lastFailure}` : '';
  return { ok: false, text: '', error: `The CLI run finished without a final answer${detail}` };
}

export interface CliRunnerOptions {
  /** Directory for the per-run MCP config files; they are removed when the run ends. */
  stateDir: string;
  /** The bridge's bin script, which the CLI starts as its `qagent mcp` server. */
  binPath: string;
  nodePath?: string;
  timeoutMs?: number;
  /** Finds the executable for a runner; the default looks on PATH and honours QAGENT_<RUNNER>_BIN. */
  resolve?: (runner: CliRunner) => CliCommand | null;
  /** Working directory for the CLI process. */
  cwd?: string;
}

const RUNNER_PACKAGE_SCRIPTS: Record<CliRunner, { pkg: string; script: string }> = {
  claude: { pkg: '@anthropic-ai/claude-code', script: 'cli.js' },
  codex: { pkg: '@openai/codex', script: 'bin/codex.js' },
};

export function systemPromptFor(tabId: number | undefined): string {
  const tab = tabId === undefined ? 'the active tab' : `tab ${tabId} (pass tabId: ${tabId} to browser tools)`;
  return [
    'You are QAgent, a browser QA agent. Operate the browser only through the qagent MCP tools',
    '(page_* tools act on the page, qagent_* tools manage the task).',
    `Your target is ${tab}. Use page_info or page_snapshot first to see the page.`,
    'Finish with a concise final answer that states what you verified and what failed.',
  ].join(' ');
}

/** Finds the executable for a runner. On Windows an npm .cmd shim is replaced by its node script. */
export function resolveCliCommand(runner: CliRunner, env: NodeJS.ProcessEnv = process.env): CliCommand | null {
  const override = env[`QAGENT_${runner.toUpperCase()}_BIN`]?.trim();
  if (override) return { file: override, prefixArgs: [] };
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, `${runner}${ext}`);
      if (!existsSync(candidate)) continue;
      if (ext !== '.cmd') return { file: candidate, prefixArgs: [] };
      // The shim runs `node <package>/<script>`; run that script directly so no shell is involved.
      const { pkg, script } = RUNNER_PACKAGE_SCRIPTS[runner];
      const entry = join(dirname(candidate), 'node_modules', ...pkg.split('/'), script);
      return existsSync(entry) ? { file: process.execPath, prefixArgs: [entry] } : null;
    }
  }
  return null;
}

interface RunPlan {
  args: string[];
  stdin: string | null;
  parser: StreamParser;
  mcpConfigPath: string | null;
}

function planRun(input: CliTaskInput, options: CliRunnerOptions, nodePath: string): RunPlan {
  const systemPrompt = systemPromptFor(input.tabId);
  if (input.runner === 'claude') {
    const mcpConfigPath = join(options.stateDir, 'cli', `${input.taskId}.mcp.json`);
    return {
      args: claudeArgs({ mcpConfigPath, systemPrompt }),
      stdin: input.task,
      parser: createClaudeParser(),
      mcpConfigPath,
    };
  }
  return {
    args: codexArgs({ nodePath, binPath: options.binPath, systemPrompt, task: input.task }),
    stdin: null,
    parser: createCodexParser(),
    mcpConfigPath: null,
  };
}

interface ActiveRun {
  child: ChildProcess;
  cancelled: boolean;
}

export class CliTaskRunner {
  private readonly active = new Map<string, ActiveRun>();
  private readonly timeoutMs: number;
  private readonly nodePath: string;

  constructor(private readonly options: CliRunnerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nodePath = options.nodePath ?? process.execPath;
  }

  /** Runs the task to completion. Step events go to `emit` as they happen. Never rejects for a CLI failure. */
  run(input: CliTaskInput, emit: CliStepEmitter): Promise<CliTaskResult> {
    if (!isValidTaskId(input.taskId)) {
      throw new BridgeError('INVALID_PARAMS', 'taskId must be 1 to 128 letters, digits, "_" or "-"');
    }
    const resolve = this.options.resolve ?? ((runner: CliRunner) => resolveCliCommand(runner));
    const command = resolve(input.runner);
    if (!command) {
      return Promise.resolve({ ok: false, text: '', error: `${input.runner} CLI was not found on PATH` });
    }
    if (this.active.has(input.taskId)) throw new BridgeError('TASK_BUSY', 'This CLI task is already running');
    const plan = planRun(input, this.options, this.nodePath);
    if (plan.mcpConfigPath) this.writeMcpConfig(plan.mcpConfigPath);
    return new Promise(resolvePromise => {
      const child = spawn(command.file, [...command.prefixArgs, ...plan.args], {
        cwd: this.options.cwd ?? process.cwd(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const run: ActiveRun = { child, cancelled: false };
      this.active.set(input.taskId, run);
      let stderr = '';
      let outcome: CliTaskResult | null = null;
      let lastFailure: string | null = null;
      const apply = (events: CliEvent[]) => {
        for (const event of events) {
          if (event.type === 'step') {
            if (event.state === 'act.fail') lastFailure = event.details;
            emit(input.taskId, event.state, event.details);
          } else outcome = { ok: event.ok, text: event.text, ...(event.error ? { error: event.error } : {}) };
        }
      };
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) apply(plan.parser.consume(line));
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS);
      });
      // A CLI that exits before reading its stdin reports EPIPE here; with no listener it would crash the daemon.
      child.stdin.on('error', () => undefined);
      if (plan.stdin !== null) child.stdin.end(plan.stdin.slice(0, MAX_TASK_CHARS));
      else child.stdin.end();
      const timer = setTimeout(() => {
        run.cancelled = true;
        child.kill('SIGKILL');
        outcome = { ok: false, text: '', error: 'The CLI run timed out' };
      }, this.timeoutMs);
      // 'error' and 'close' can both fire for one child; the run must settle once.
      let finished = false;
      const finish = (fallbackError?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.active.delete(input.taskId);
        if (plan.mcpConfigPath) rmSync(plan.mcpConfigPath, { force: true });
        if (buffer) apply(plan.parser.consume(buffer));
        apply(plan.parser.finish());
        const result: CliTaskResult = outcome ?? {
          ok: false,
          text: '',
          error: run.cancelled
            ? 'The CLI run was cancelled'
            : (fallbackError ?? (stderr.trim() || 'The CLI run failed')),
        };
        resolvePromise(requireFinalAnswer(result, lastFailure));
      };
      child.on('error', error => finish(error.message));
      child.on('close', () => finish());
    });
  }

  /** Stops a running CLI task. Returns false when no such task runs. */
  cancel(taskId: string): boolean {
    const run = this.active.get(taskId);
    if (!run) return false;
    run.cancelled = true;
    run.child.kill('SIGKILL');
    return true;
  }

  private writeMcpConfig(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(claudeMcpConfig(this.nodePath, this.options.binPath), null, 2), { mode: 0o600 });
  }
}

export function isRunner(value: unknown): value is CliRunner {
  return typeof value === 'string' && (CLI_RUNNERS as readonly string[]).includes(value);
}
