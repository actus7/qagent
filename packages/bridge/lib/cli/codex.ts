// Codex CLI (`codex exec --json`). The task is the last argv element; the browser comes from a `qagent` MCP
// server passed with -c overrides, so the user's own Codex config stays as it is.
import { clipDetails, parseJsonLine, type CliEvent, type StreamParser } from './types';

const CODEX_MCP_SERVER_NAME = 'qagent';

// TOML basic strings share JSON's escaping for everything we pass (paths, prompts, argv).
const toml = (value: string): string => JSON.stringify(value);
const tomlArray = (values: string[]): string => `[${values.map(toml).join(', ')}]`;

export function codexArgs(options: {
  nodePath: string;
  binPath: string;
  systemPrompt: string;
  task: string;
}): string[] {
  const server = `mcp_servers.${CODEX_MCP_SERVER_NAME}`;
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    // Headless run on the user's machine: approvals and sandboxing would stop it at the first step.
    '--dangerously-bypass-approvals-and-sandbox',
    '-c',
    `${server}.command=${toml(options.nodePath)}`,
    '-c',
    `${server}.args=${tomlArray([options.binPath, 'mcp'])}`,
    '-c',
    `developer_instructions=${toml(options.systemPrompt)}`,
    '--',
    options.task,
  ];
}

interface CodexItem {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  server?: unknown;
  tool?: unknown;
  arguments?: unknown;
  command?: unknown;
  status?: unknown;
  exit_code?: unknown;
  error?: unknown;
}

function describeItem(item: CodexItem): string {
  if (item.type === 'command_execution') return clipDetails(`shell: ${String(item.command ?? '')}`);
  const args = item.arguments === undefined ? '' : JSON.stringify(item.arguments);
  return clipDetails(`${String(item.tool ?? 'tool')} ${args}`.trim());
}

function itemFailed(item: CodexItem): boolean {
  if (item.status === 'failed' || (item.error !== undefined && item.error !== null)) return true;
  return typeof item.exit_code === 'number' && item.exit_code !== 0;
}

export function createCodexParser(): StreamParser {
  let lastText = '';
  let lastError = '';
  let finished = false;

  const done = (ok: boolean, text: string, error?: string): CliEvent[] => {
    finished = true;
    return [{ type: 'done', ok, text, ...(error ? { error } : {}) }];
  };

  return {
    consume(line) {
      const frame = parseJsonLine(line);
      if (!frame || finished) return [];
      const item = (frame.item ?? {}) as CodexItem;
      const isTool = item.type === 'mcp_tool_call' || item.type === 'command_execution';
      switch (frame.type) {
        case 'item.started':
          return isTool ? [{ type: 'step', state: 'act.start', details: describeItem(item) }] : [];
        case 'item.completed': {
          if (item.type === 'agent_message' && typeof item.text === 'string') lastText = item.text;
          if (!isTool) return [];
          return [{ type: 'step', state: itemFailed(item) ? 'act.fail' : 'act.ok', details: describeItem(item) }];
        }
        case 'turn.completed':
          return done(true, lastText);
        case 'turn.failed': {
          const error = (frame.error as { message?: unknown } | undefined)?.message;
          return done(false, '', typeof error === 'string' ? error : 'Codex turn failed');
        }
        case 'error':
          // Codex reports some errors as events and keeps going; the terminal event decides the outcome.
          lastError = typeof frame.message === 'string' ? frame.message : lastError;
          return [];
        default:
          return [];
      }
    },
    finish() {
      return finished ? [] : done(false, '', lastError || 'Codex exited without a result');
    },
  };
}
