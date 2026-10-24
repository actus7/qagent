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

describe('NavigatorAgent tool call with action encoded as JSON text', () => {
  it('passes the action text through untouched instead of spreading it into characters', async () => {
    const actionText = '[{"click_element":{"index":72,"intent":"open Usage"}}]';
    const withStructuredOutput = vi.fn(() => ({
      invoke: vi.fn().mockResolvedValue({
        parsed: null,
        raw: {
          content: '',
          tool_calls: [
            {
              args: {
                current_state: { evaluation_previous_goal: 'n/a', memory: 'n/a', next_goal: 'open Usage' },
                action: actionText,
              },
            },
          ],
        },
      }),
    }));

    const chatLLM = {
      constructor: { name: 'TestModel' },
      modelName: 'mimo-v2.6-pro',
      withStructuredOutput,
    } as unknown as BaseChatModel;

    const agent = new NavigatorAgent(new NavigatorActionRegistry([]), {
      chatLLM,
      context: { controller: new AbortController() } as AgentContext,
      prompt: new TestPrompt(),
    });

    const output = await agent.invoke([new HumanMessage('test')]);

    expect(output.action).toEqual(actionText);
  });
});
