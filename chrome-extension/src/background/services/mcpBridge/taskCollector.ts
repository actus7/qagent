import type { SidePanelResponseMessage } from '@extension/shared';
import { doneActionSchema } from '../../agent/actions/schemas';

export interface StepSummary {
  step: number;
  state: string;
  details: string;
}

export interface TaskRunOutcome {
  status: 'completed' | 'failed' | 'cancelled' | 'unknown';
  answer: string | null;
  error: string | null;
  steps: StepSummary[];
}

const MAX_STEPS = 100;
const MAX_DETAIL_CHARS = 300;
const TERMINAL_STATES: Record<string, TaskRunOutcome['status']> = {
  'task.ok': 'completed',
  'task.fail': 'failed',
  'task.cancel': 'cancelled',
};

function truncate(text: string): string {
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text;
}

/**
 * Watches the panel message stream for one task and builds its outcome: the final answer
 * (done action text in act mode, finished stream in chat/plan mode) and a short step log.
 */
export function createTaskCollector(taskId: string) {
  const steps: StepSummary[] = [];
  let terminalState: string | null = null;
  let terminalDetails = '';
  let lastActStart = '';
  let doneAnswer: string | null = null;
  let streamAnswer: string | null = null;

  const observe = (message: SidePanelResponseMessage): void => {
    if (message.type === 'assistant_delta' && message.taskId === taskId) {
      if (message.finished) streamAnswer = message.content;
      return;
    }
    if (message.type !== 'execution' || message.data.taskId !== taskId) return;

    const { state, data } = message;
    if (TERMINAL_STATES[state]) {
      terminalState = state;
      terminalDetails = data.details;
      return;
    }
    if (state === 'act.start') lastActStart = data.details;
    if (state === 'act.ok' && lastActStart === doneActionSchema.name) doneAnswer = data.details;
    if ((state.startsWith('act.') || state.startsWith('step.')) && steps.length < MAX_STEPS) {
      steps.push({ step: data.step, state, details: truncate(data.details) });
    }
  };

  const result = (): TaskRunOutcome => {
    const status = terminalState ? TERMINAL_STATES[terminalState] : 'unknown';
    return {
      status,
      answer: doneAnswer ?? streamAnswer,
      error: status === 'failed' ? terminalDetails || 'Task failed' : null,
      steps,
    };
  };

  return { observe, result };
}
