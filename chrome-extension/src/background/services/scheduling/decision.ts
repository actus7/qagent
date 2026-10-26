import type { ScheduledTask } from '@extension/storage';

export const BUSY_SKIP_DETAIL = 'ignorada: outra tarefa em execução';

export type ScheduledRunDecision =
  { action: 'ignore' } | { action: 'skip'; detail: string } | { action: 'block'; detail: string } | { action: 'run' };

export interface ScheduledRunInput {
  task: ScheduledTask | undefined;
  busy: boolean;
}

/**
 * Decides what a due schedule does now. Order matters: a missing task is ignored, a busy worker skips the run,
 * and only then are the task's own inputs checked, so a skipped run never reaches the browser.
 */
export function decideScheduledRun({ task, busy }: ScheduledRunInput): ScheduledRunDecision {
  if (!task) return { action: 'ignore' };
  if (busy) return { action: 'skip', detail: BUSY_SKIP_DETAIL };
  if (task.mode === 'act' && !task.startUrl) {
    return { action: 'block', detail: 'bloqueada: o modo agir precisa de uma URL inicial' };
  }
  return { action: 'run' };
}
