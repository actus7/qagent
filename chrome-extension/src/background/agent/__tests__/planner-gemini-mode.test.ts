import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../types';
import { BasePrompt } from '../prompts/base';
import { PlannerAgent } from '../agents/planner';

class TestPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage('system');
  }

  async getUserMessage(): Promise<HumanMessage> {
    return new HumanMessage('user');
  }
}

describe('PlannerAgent Gemini mode', () => {
  it('uses manual JSON extraction mode for Gemini instead of structured output', async () => {
    const withStructuredOutput = vi.fn(() => ({
      invoke: vi.fn(),
    }));
    const invoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        observation: 'observed mobile nav icon',
        challenges: 'none',
        done: false,
        next_steps: 'click menu icon and validate options',
        final_answer: '',
        reasoning: 'need to inspect responsive menu behavior',
        web_task: true,
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

    const agent = new PlannerAgent({
      chatLLM,
      context,
      prompt: new TestPrompt(),
    });

    const output = await agent.invoke([new HumanMessage('test')]);

    expect(withStructuredOutput).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(output.done).toBe(false);
    expect(output.web_task).toBe(true);
  });
});
