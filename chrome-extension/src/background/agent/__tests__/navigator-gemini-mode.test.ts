import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../types';
import { BasePrompt } from '../prompts/base';
import { NavigatorActionRegistry, NavigatorAgent } from '../agents/navigator';

class TestPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage('system');
  }

  async getUserMessage(): Promise<HumanMessage> {
    return new HumanMessage('user');
  }
}

describe('NavigatorAgent Gemini mode', () => {
  it('uses manual JSON extraction mode for Gemini instead of structured output', async () => {
    const withStructuredOutput = vi.fn(() => ({
      invoke: vi.fn(),
    }));
    const invoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        current_state: {
          evaluation_previous_goal: 'n/a',
          memory: 'n/a',
          next_goal: 'inspect mobile menu',
        },
        action: [],
      }),
    });

    const chatLLM = {
      constructor: { name: 'TestModel' },
      modelName: 'gemini-2.5-flash',
      withStructuredOutput,
      invoke,
    } as unknown as BaseChatModel;

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new NavigatorAgent(new NavigatorActionRegistry([]), {
      chatLLM,
      context,
      prompt: new TestPrompt(),
    });

    const output = await agent.invoke([new HumanMessage('test')]);

    expect(withStructuredOutput).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(output.current_state.next_goal).toBe('inspect mobile menu');
    expect(output.action).toEqual([]);
  });
});
