import { wrapUntrustedContent } from './messages/utils';

// ponytail: fixed caps instead of a token count; the memory is a hint, not a transcript.
const MAX_MEMORY_CHARS = 4000;
const MAX_TASK_CHARS = 2000;
const MAX_ANSWER_CHARS = 2000;
const MAX_ACTIONS = 15;
const MAX_ACTION_CHARS = 300;

export type TaskMemoryOutcome = 'completed' | 'failed' | 'cancelled' | 'paused' | 'interrupted';

export interface TaskMemoryAction {
  content: string | null;
  error: string | null;
}

export interface TaskMemoryInput {
  task: string;
  outcome: TaskMemoryOutcome;
  finalAnswer: string | null;
  url: string | null;
  actions: TaskMemoryAction[];
}

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}...` : text);

/** Summarizes a finished act task so a follow-up can continue it without replaying the whole executor history. */
export function buildTaskMemory(input: TaskMemoryInput): string {
  const actionLines = input.actions
    .map(action => action.error ?? action.content)
    .filter((line): line is string => Boolean(line && line.trim()))
    .slice(-MAX_ACTIONS)
    .map(line => `- ${clip(line.trim(), MAX_ACTION_CHARS)}`);
  const actions = actionLines.length > 0 ? wrapUntrustedContent(actionLines.join('\n')) : '(no recorded actions)';
  const memory = [
    `Previous task: ${clip(input.task, MAX_TASK_CHARS)}`,
    `Outcome: ${input.outcome}`,
    `Final answer: ${input.finalAnswer ? clip(input.finalAnswer, MAX_ANSWER_CHARS) : '(none)'}`,
    `Current page URL: ${input.url || '(unknown)'}`,
    `Key action results:\n${actions}`,
  ].join('\n');
  return clip(memory, MAX_MEMORY_CHARS);
}

export interface FollowUpTaskParts {
  memory: string | null;
  history: string;
  currentTask: string;
}

/** Builds the task text for a follow-up: prior outcome first, then the chat so far, then the new request. */
export function composeFollowUpTask({ memory, history, currentTask }: FollowUpTaskParts): string {
  const sections: string[] = [];
  if (memory) {
    sections.push(
      `Memory of the previous task (already executed in this browser; continue from it and do not repeat it unless asked):\n${memory}`,
    );
  }
  if (history) sections.push(`Conversation context (prior requests are context only):\n${history}`);
  if (sections.length === 0) return currentTask;
  sections.push(`Current user task:\n${currentTask}`);
  return sections.join('\n\n');
}
