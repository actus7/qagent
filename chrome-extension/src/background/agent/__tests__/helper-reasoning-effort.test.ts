import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig, ProviderConfig } from '@extension/storage';
import { ProviderTypeEnum } from '@extension/storage';

const openAICalls: unknown[] = [];
const azureCalls: unknown[] = [];

vi.mock('@langchain/openai', () => {
  class ChatOpenAI {
    constructor(args: unknown) {
      openAICalls.push(args);
    }
  }

  class AzureChatOpenAI {
    constructor(args: unknown) {
      azureCalls.push(args);
    }
  }

  return { ChatOpenAI, AzureChatOpenAI };
});

describe('createChatModel reasoning effort compatibility', () => {
  beforeEach(() => {
    openAICalls.length = 0;
    azureCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps legacy minimal/none to none for OpenAI gpt-5.1', async () => {
    const { createChatModel } = await import('../helper');
    const providerConfig: ProviderConfig = {
      apiKey: 'sk-test',
      type: ProviderTypeEnum.OpenAI,
    };
    const modelConfig: ModelConfig = {
      provider: ProviderTypeEnum.OpenAI,
      modelName: 'gpt-5.1',
      reasoningEffort: 'minimal/none' as unknown as ModelConfig['reasoningEffort'],
    };

    createChatModel(providerConfig, modelConfig);

    const args = openAICalls[0] as {
      modelKwargs?: {
        reasoning_effort?: string;
      };
    };
    expect(args.modelKwargs?.reasoning_effort).toBe('none');
  });

  it('maps legacy minimal/none to none for Azure gpt-5.1 deployments', async () => {
    const { createChatModel } = await import('../helper');
    const providerConfig: ProviderConfig = {
      apiKey: 'azure-key',
      type: ProviderTypeEnum.AzureOpenAI,
      baseUrl: 'https://my-instance.openai.azure.com/',
      azureDeploymentNames: ['gpt-5.1'],
      azureApiVersion: '2025-04-01-preview',
    };
    const modelConfig: ModelConfig = {
      provider: ProviderTypeEnum.AzureOpenAI,
      modelName: 'gpt-5.1',
      reasoningEffort: 'minimal/none' as unknown as ModelConfig['reasoningEffort'],
    };

    createChatModel(providerConfig, modelConfig);

    const args = azureCalls[0] as {
      modelKwargs?: {
        reasoning_effort?: string;
      };
    };
    expect(args.modelKwargs?.reasoning_effort).toBe('none');
  });

  it('keeps canonical minimal for GPT-5 models other than 5.1', async () => {
    const { createChatModel } = await import('../helper');
    const providerConfig: ProviderConfig = {
      apiKey: 'sk-test',
      type: ProviderTypeEnum.OpenAI,
    };
    const modelConfig: ModelConfig = {
      provider: ProviderTypeEnum.OpenAI,
      modelName: 'gpt-5',
      reasoningEffort: 'minimal',
    };

    createChatModel(providerConfig, modelConfig);

    const args = openAICalls[0] as {
      modelKwargs?: {
        reasoning_effort?: string;
      };
    };
    expect(args.modelKwargs?.reasoning_effort).toBe('minimal');
  });
});
