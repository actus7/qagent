import { describe, expect, it, vi } from 'vitest';
import type * as AiModule from 'ai';
import { generateText } from 'ai';
import type { AgentContext } from '../types';
import { BasePrompt } from '../prompts/base';
import { NavigatorActionRegistry, NavigatorAgent } from '../agents/navigator';
import { systemMessage, userMessage } from '../messages/model-messages';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';

vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof AiModule>()), generateText: vi.fn() }));

class TestPrompt extends BasePrompt {
  getSystemMessage() {
    return systemMessage('system');
  }

  async getUserMessage() {
    return userMessage('user');
  }
}

describe('NavigatorAgent Gemini mode', () => {
  it('uses manual JSON extraction mode for Gemini instead of structured output', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        current_state: {
          evaluation_previous_goal: 'n/a',
          memory: 'n/a',
          next_goal: 'inspect mobile menu',
        },
        action: [],
      }),
      toolCalls: [],
    } as never);

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new NavigatorAgent(new NavigatorActionRegistry([]), {
      chatLLM: fakeChatModel('gemini-2.5-flash'),
      context,
      prompt: new TestPrompt(),
    });

    const output = await agent.invoke([userMessage('test')]);

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateText).mock.calls[0][0]).not.toHaveProperty('tools');
    expect(output.current_state.next_goal).toBe('inspect mobile menu');
    expect(output.action).toEqual([]);
  });
});
