import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NavigatorActionRegistry, NavigatorAgent } from '../agents/navigator';
import { Action } from '../actions/builder';
import { ActionResult, type AgentContext } from '../types';
import { RequestCancelledError } from '../agents/errors';
import { BasePrompt } from '../prompts/base';
import { systemMessage, userMessage } from '../messages/model-messages';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';

class TestPrompt extends BasePrompt {
  getSystemMessage() {
    return systemMessage('system');
  }
  async getUserMessage() {
    return userMessage('user');
  }
}

describe('navigator action cancellation', () => {
  it('never executes a queued completion action after the task is cancelled', async () => {
    const declined = new Action(
      async () => {
        throw new RequestCancelledError('Ação recusada.');
      },
      { name: 'click', description: 'Click', schema: z.object({}) },
    );
    const finish = vi.fn().mockResolvedValue(new ActionResult({ isDone: true }));
    const done = new Action(finish, { name: 'done', description: 'Complete', schema: z.object({}) });
    const context = {
      controller: new AbortController(),
      paused: false,
      stopped: false,
      options: { useVision: false },
      browserContext: {
        getState: vi.fn().mockResolvedValue({ selectorMap: new Map() }),
        getCachedState: vi.fn().mockResolvedValue({ selectorMap: new Map() }),
        removeHighlight: vi.fn().mockResolvedValue(undefined),
      },
      emitEvent: vi.fn(),
    } as unknown as AgentContext;
    const agent = new NavigatorAgent(new NavigatorActionRegistry([declined, done]), {
      context,
      prompt: new TestPrompt(),
      chatLLM: fakeChatModel('test'),
    });
    const execute = agent as unknown as { doMultiAction: (actions: Record<string, unknown>[]) => Promise<unknown> };
    await expect(execute.doMultiAction([{ click: {} }, { done: {} }])).rejects.toThrow('recusada');
    expect(finish).not.toHaveBeenCalled();
  });
});
