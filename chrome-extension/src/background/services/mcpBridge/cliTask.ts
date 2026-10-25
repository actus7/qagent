// Runs an assistant task through a CLI agent (Claude Code or Codex) hosted by the daemon. The daemon streams
// the steps; they are forwarded to the side panel as normal execution events.
import type { ExecutionPortEventMessage, McpBridgeCliRunner } from '@extension/shared';
import { mcpBridgeStore } from '@extension/storage';
import { Actors, ExecutionState } from '../../agent/event/types';
import { mcpBridgeClient } from './client';

// A CLI run can take as long as the daemon allows (20 minutes); this is the extension-side backstop.
const CLI_TASK_TIMEOUT_MS = 25 * 60 * 1000;
const CANCEL_TIMEOUT_MS = 10 * 1000;
const EXECUTION_STATES: ReadonlySet<string> = new Set<string>(Object.values(ExecutionState));

export interface CliTaskOutcome {
  ok: boolean;
  text: string;
  error?: string;
}

export interface CliTaskInput {
  taskId: string;
  task: string;
  tabId: number;
  runner: McpBridgeCliRunner;
  signal: AbortSignal;
  post: (event: ExecutionPortEventMessage) => void;
}

export async function runCliAgentTask(input: CliTaskInput): Promise<CliTaskOutcome> {
  let step = 0;
  const unsubscribe = mcpBridgeClient.subscribeEvents(event => {
    if (event.taskId !== input.taskId || !EXECUTION_STATES.has(event.state)) return;
    if (event.state === ExecutionState.ACT_START) step += 1;
    input.post({
      type: 'execution',
      actor: Actors.NAVIGATOR,
      state: event.state,
      data: { taskId: input.taskId, step, maxSteps: 0, details: event.details },
      timestamp: Date.now(),
    });
  });
  const onAbort = () => {
    void mcpBridgeClient.hostRequest('cancel_cli_task', { taskId: input.taskId }, CANCEL_TIMEOUT_MS).catch(() => {});
  };
  input.signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await mcpBridgeClient.hostRequest<CliTaskOutcome>(
      'run_cli_task',
      { taskId: input.taskId, runner: input.runner, task: input.task, tabId: input.tabId },
      CLI_TASK_TIMEOUT_MS,
    );
  } catch (error) {
    return { ok: false, text: '', error: error instanceof Error ? error.message : String(error) };
  } finally {
    unsubscribe();
    input.signal.removeEventListener('abort', onAbort);
  }
}

/** The CLI agent chosen in options, or null when the built-in agent runs the task. */
export async function selectedCliRunner(): Promise<McpBridgeCliRunner | null> {
  const { cliAgent } = await mcpBridgeStore.getConfig();
  return cliAgent === 'off' ? null : cliAgent;
}
