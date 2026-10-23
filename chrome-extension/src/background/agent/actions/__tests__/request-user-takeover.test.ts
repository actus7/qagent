import { describe, expect, it } from 'vitest';
import { AgentContext } from '../../types';
import type { AgentEvent} from '../../event/types';
import { Actors, ExecutionState } from '../../event/types';
import { createRequestUserTakeoverAction } from '../takeover';

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

describe('request_user_takeover action', () => {
  it('pauses the task and emits a pause event carrying the reason and message', async () => {
    const { context, emitted } = createContext();
    const action = createRequestUserTakeoverAction(context);

    const result = await action.call({ reason: 'captcha', message: 'Resolva o CAPTCHA e volte.' });

    expect(context.paused).toBe(true);
    expect(result.includeInMemory).toBe(true);
    const pauseEvent = emitted.find(event => event.state === ExecutionState.TASK_PAUSE);
    expect(pauseEvent?.actor).toBe(Actors.NAVIGATOR);
    expect(pauseEvent?.data.details).toBe('Resolva o CAPTCHA e volte.');
    expect(pauseEvent?.data.takeover).toEqual({
      reason: 'captcha',
      reasonLabel: expect.any(String),
      message: 'Resolva o CAPTCHA e volte.',
    });
  });

  it('marks the next navigator step to re-read the page after resume', async () => {
    const { context } = createContext();
    await context.pause();
    await context.resume();

    expect(context.paused).toBe(false);
    expect(context.pageStale).toBe(true);
  });

  it('rejects an unknown reason', async () => {
    const { context } = createContext();
    const action = createRequestUserTakeoverAction(context);

    await expect(action.call({ reason: 'password', message: 'x' })).rejects.toThrow();
    expect(context.paused).toBe(false);
  });
});
