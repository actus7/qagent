import { describe, expect, it, vi } from 'vitest';
import type { SystemModelMessage, UserModelMessage } from 'ai';
import type * as AiModule from 'ai';
import { generateText } from 'ai';
import type { AgentContext } from '../types';
import { BasePrompt } from '../prompts/base';
import { PlannerAgent } from '../agents/planner';
import { systemMessage, userMessage } from '../messages/model-messages';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';

vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof AiModule>()), generateText: vi.fn() }));

class TestPrompt extends BasePrompt {
  getSystemMessage(): SystemModelMessage {
    return systemMessage('system');
  }

  async getUserMessage(): Promise<UserModelMessage> {
    return userMessage('user');
  }
}

describe('PlannerAgent Gemini mode', () => {
  it('uses manual JSON extraction mode for Gemini instead of structured output', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        observation: 'observed mobile nav icon',
        challenges: 'none',
        done: false,
        next_steps: 'click menu icon and validate options',
        final_answer: '',
        reasoning: 'need to inspect responsive menu behavior',
        web_task: true,
      }),
      toolCalls: [],
    } as never);

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new PlannerAgent({
      chatLLM: fakeChatModel('gemini-2.5-flash'),
      context,
      prompt: new TestPrompt(),
    });

    const output = await agent.invoke([userMessage('test')]);

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateText).mock.calls[0][0]).not.toHaveProperty('tools');
    expect(output.done).toBe(false);
    expect(output.web_task).toBe(true);
  });
});
