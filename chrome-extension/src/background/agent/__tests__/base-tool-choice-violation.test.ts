import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as AiModule from 'ai';
import { generateText, ToolChoiceViolationError } from 'ai';
import { BaseAgent } from '../agents/base';
import { BasePrompt } from '../prompts/base';
import type { AgentContext, AgentOutput } from '../types';
import { systemMessage, userMessage } from '../messages/model-messages';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';

vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof AiModule>()), generateText: vi.fn() }));

const schema = z.object({ next_goal: z.string() });

class TestPrompt extends BasePrompt {
  getSystemMessage() {
    return systemMessage('system');
  }
  async getUserMessage() {
    return userMessage('user');
  }
}

class TestAgent extends BaseAgent<typeof schema, never> {
  constructor() {
    super(schema, {
      chatLLM: fakeChatModel('mimo-v2.6-pro'),
      context: { controller: new AbortController() } as AgentContext,
      prompt: new TestPrompt(),
    });
  }
  async execute(): Promise<AgentOutput<never>> {
    return { id: this.id };
  }
}

const violation = (content: Array<Record<string, unknown>>) =>
  new ToolChoiceViolationError({
    toolChoice: { type: 'tool', toolName: 'agent_output' },
    finishReason: 'stop',
    provider: 'test',
    modelId: 'mimo-v2.6-pro',
    content: content as never,
  });

describe('BaseAgent when the model ignores the forced tool', () => {
  afterEach(() => vi.mocked(generateText).mockReset());

  it('reads a tool call made under another name', async () => {
    vi.mocked(generateText).mockRejectedValue(
      violation([{ type: 'tool-call', toolCallId: '1', toolName: 'AgentOutput', input: '{"next_goal":"open"}' }]),
    );

    expect(await new TestAgent().invoke([userMessage('go')])).toEqual({ next_goal: 'open' });
  });

  it('reads JSON answered as plain text', async () => {
    vi.mocked(generateText).mockRejectedValue(
      violation([{ type: 'text', text: 'Here you go:\n```json\n{"next_goal":"scroll"}\n```' }]),
    );

    expect(await new TestAgent().invoke([userMessage('go')])).toEqual({ next_goal: 'scroll' });
  });

  it('still fails when the content holds no usable answer', async () => {
    vi.mocked(generateText).mockRejectedValue(violation([{ type: 'text', text: 'I cannot help with that.' }]));

    await expect(new TestAgent().invoke([userMessage('go')])).rejects.toThrow('required tool');
  });
});
