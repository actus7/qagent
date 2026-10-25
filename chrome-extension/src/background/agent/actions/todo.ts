import { ActionResult, type AgentContext, type TodoItem } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { todoWriteActionSchema } from './schemas';

const STATUS_MARKS: Record<TodoItem['status'], string> = { pending: '[ ]', in_progress: '[~]', done: '[x]' };

export function formatTodoChecklist(items: TodoItem[]): string {
  return items.map(item => `${STATUS_MARKS[item.status]} ${item.text}`).join('\n');
}

/** Checklist section for the state message; empty until the agent writes a list. */
export function buildTodoPromptSection(items: TodoItem[]): string {
  if (items.length === 0) return '';
  return `Task checklist (todo_write replaces it):\n${formatTodoChecklist(items)}\n`;
}

/**
 * Replaces the task checklist. The list is emitted as a chat line (ACT_START is the event the panel shows)
 * and repeated in every navigator step through the context.
 */
export function createTodoWriteAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof todoWriteActionSchema.schema>) => {
    context.todos = input.items;
    const done = input.items.filter(item => item.status === 'done').length;
    const header = t('act_todoWrite_header', [done.toString(), input.items.length.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `${header}\n${formatTodoChecklist(input.items)}`);
    return new ActionResult({
      extractedContent: `Checklist updated: ${done} of ${input.items.length} done.`,
      includeInMemory: true,
    });
  }, todoWriteActionSchema);
}
