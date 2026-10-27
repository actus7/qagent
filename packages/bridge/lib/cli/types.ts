// Shared shapes for CLI agent runs. A runner turns one CLI's JSON stream into these events.

/** Progress for the side panel, in ExecutionState terms. */
export type CliStepEvent = {
  type: 'step';
  state: 'act.start' | 'act.ok' | 'act.fail';
  details: string;
};

/** The run has finished. Emitted once per run; `finish()` supplies it when the stream ended without one. */
export type CliDoneEvent = {
  type: 'done';
  ok: boolean;
  text: string;
  error?: string;
};

export type CliEvent = CliStepEvent | CliDoneEvent;

export interface StreamParser {
  /** Consumes one line of the CLI's stdout and returns the events it produced. Non-JSON lines are ignored. */
  consume(line: string): CliEvent[];
  /** Called when the process exits. Returns a failing done event when no result arrived. */
  finish(): CliEvent[];
}

/** Keeps a step line short: the side panel shows it, and it may hold page content. */
const STEP_DETAILS_MAX_CHARS = 200;

export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function clipDetails(text: string): string {
  return text.length > STEP_DETAILS_MAX_CHARS ? `${text.slice(0, STEP_DETAILS_MAX_CHARS)}...` : text;
}
