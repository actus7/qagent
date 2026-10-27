import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as AiModule from 'ai';
import { generateText } from 'ai';
import { AgentNameEnum, ProviderTypeEnum } from '@extension/storage';
import { BaseAgent } from '../agents/base';
import { BasePrompt } from '../prompts/base';
import { ModelFailover, orderCandidates } from '../model-failover';
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

class FailoverTestAgent extends BaseAgent<typeof schema, never> {
  constructor(context: AgentContext, chatLLM: ReturnType<typeof fakeChatModel>) {
    super(schema, { chatLLM, context, prompt: new TestPrompt() });
  }
  async execute(): Promise<AgentOutput<never>> {
    return { id: this.id };
  }
}

const providers = {
  first: { type: ProviderTypeEnum.CustomOpenAI, apiKey: 'k', modelNames: ['model-a'] },
  second: { type: ProviderTypeEnum.CustomOpenAI, apiKey: 'k', modelNames: ['model-b'] },
};

describe('BaseAgent failover calls', () => {
  afterEach(() => vi.mocked(generateText).mockReset());

  it('calls the model that the failover hands over, not the agent field it was built with', async () => {
    const failover = new ModelFailover(
      AgentNameEnum.Navigator,
      orderCandidates({ provider: 'first', modelName: 'model-a' }, providers, {}),
      {},
      {
        createChatModel: (_provider, config) => fakeChatModel(config.modelName, config.provider),
        persistSlotModel: async () => {},
        saveHealth: async () => {},
      },
    );
    const context = {
      controller: new AbortController(),
      emitEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentContext;
    const agent = new FailoverTestAgent(context, failover.primaryModel);

    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error('model-a is down'))
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ toolName: 'agent_output', input: { next_goal: 'open' }, invalid: false }],
      } as never);

    expect(await agent.invoke([userMessage('go')])).toEqual({ next_goal: 'open' });

    const calledModels = vi
      .mocked(generateText)
      .mock.calls.map(([options]) => (options as unknown as { model: { modelId: string } }).model.modelId);
    expect(calledModels).toEqual(['model-a', 'model-b']);
  });
});
