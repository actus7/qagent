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

describe('NavigatorAgent tool call with action encoded as JSON text', () => {
  it('passes the action text through untouched instead of validating or spreading it', async () => {
    const actionText = '[{"click_element":{"index":72,"intent":"open Usage"}}]';
    vi.mocked(generateText).mockResolvedValue({
      text: '',
      toolCalls: [
        {
          toolCallId: 'c1',
          toolName: 'navigator_output',
          input: {
            current_state: { evaluation_previous_goal: 'n/a', memory: 'n/a', next_goal: 'open Usage' },
            action: actionText,
          },
        },
      ],
    } as never);

    const agent = new NavigatorAgent(new NavigatorActionRegistry([]), {
      chatLLM: fakeChatModel('mimo-v2.6-pro'),
      context: { controller: new AbortController() } as AgentContext,
      prompt: new TestPrompt(),
    });

    const output = await agent.invoke([userMessage('test')]);

    expect(output.action).toEqual(actionText);
    const options = vi.mocked(generateText).mock.calls[0][0] as { toolChoice?: unknown };
    expect(options.toolChoice).toEqual({ type: 'tool', toolName: 'navigator_output' });
  });
});
