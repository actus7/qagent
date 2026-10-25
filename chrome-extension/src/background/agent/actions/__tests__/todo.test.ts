import { describe, expect, it } from 'vitest';
import { AgentContext } from '../../types';
import type { AgentEvent } from '../../event/types';
import { ExecutionState } from '../../event/types';
import { buildTodoPromptSection, createTodoWriteAction } from '../todo';

function createContext() {
  const emitted: AgentEvent[] = [];
  const eventManager = {
    emit: async (event: AgentEvent) => {
      emitted.push(event);
    },
  };
  const context = new AgentContext('task-1', {} as never, {} as never, eventManager as never, {});
  return { context, emitted };
}

const items = [
  { text: 'Open the login page', status: 'done' as const },
  { text: 'Fill the form', status: 'in_progress' as const },
  { text: 'Check the dashboard', status: 'pending' as const },
];

describe('todo_write action', () => {
  it('replaces the checklist in the context and emits it as a panel line', async () => {
    const { context, emitted } = createContext();
    const action = createTodoWriteAction(context);

    const result = await action.call({ items });

    expect(context.todos).toEqual(items);
    const line = emitted.find(event => event.state === ExecutionState.ACT_START);
    expect(line?.data.details).toContain('[x] Open the login page');
    expect(line?.data.details).toContain('[~] Fill the form');
    expect(line?.data.details).toContain('[ ] Check the dashboard');
    expect(result.extractedContent).toContain('1 of 3 done');
  });

  it('rejects an unknown status', async () => {
    const { context } = createContext();
    const action = createTodoWriteAction(context);

    await expect(action.call({ items: [{ text: 'x', status: 'blocked' }] })).rejects.toThrow();
    expect(context.todos).toEqual([]);
  });

  it('adds no prompt section while the checklist is empty', () => {
    expect(buildTodoPromptSection([])).toBe('');
    expect(buildTodoPromptSection(items)).toContain('[~] Fill the form');
  });
});
