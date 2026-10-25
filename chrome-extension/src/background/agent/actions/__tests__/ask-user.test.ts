import { describe, expect, it } from 'vitest';
import { AgentContext } from '../../types';
import type { AgentEvent } from '../../event/types';
import { Actors, ExecutionState } from '../../event/types';
import { createAskUserAction } from '../ask-user';

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

describe('ask_user action', () => {
  it('shows the question and options in the panel, then returns the answer as the result', async () => {
    const { context, emitted } = createContext();
    const action = createAskUserAction(context);

    const pending = action.call({ question: 'Which plan?', options: ['Basic', 'Pro'] });
    const questionEvent = emitted.find(event => event.data.question);

    expect(questionEvent?.actor).toBe(Actors.NAVIGATOR);
    expect(questionEvent?.state).toBe(ExecutionState.ACT_START);
    expect(questionEvent?.data.question).toEqual({ question: 'Which plan?', options: ['Basic', 'Pro'] });

    expect(context.answerUserQuestion('Pro')).toBe(true);
    const result = await pending;
    expect(result.extractedContent).toBe('User answered: Pro');
    expect(result.includeInMemory).toBe(true);
  });

  it('returns without an answer when the task is stopped while waiting', async () => {
    const { context } = createContext();
    const action = createAskUserAction(context);

    const pending = action.call({ question: 'Continue?' });
    void context.stop();
    const result = await pending;

    expect(result.extractedContent).toContain('did not answer');
  });

  it('drops an answer that arrives when no question is waiting', () => {
    const { context } = createContext();

    expect(context.answerUserQuestion('late')).toBe(false);
  });
});
