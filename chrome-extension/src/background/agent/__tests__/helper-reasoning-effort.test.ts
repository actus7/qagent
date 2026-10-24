import { describe, expect, it } from 'vitest';
import type { ModelConfig, ProviderConfig } from '@extension/storage';
import { ProviderTypeEnum } from '@extension/storage';
import { createChatModel } from '../helper';

describe('createChatModel reasoning effort compatibility', () => {
  it('maps legacy minimal/none to none for OpenAI gpt-5.1', () => {
    const providerConfig: ProviderConfig = {
      apiKey: 'sk-test',
      type: ProviderTypeEnum.OpenAI,
    };
    const modelConfig: ModelConfig = {
      provider: ProviderTypeEnum.OpenAI,
      modelName: 'gpt-5.1',
      reasoningEffort: 'minimal/none' as unknown as ModelConfig['reasoningEffort'],
    };

    const chat = createChatModel(providerConfig, modelConfig);

    expect(chat.settings.reasoning).toBe('none');
    // reasoning models take no sampling parameters
    expect(chat.settings.temperature).toBeUndefined();
    expect(chat.modelName).toBe('gpt-5.1');
  });

  it('maps legacy minimal/none to none for Azure gpt-5.1 deployments', () => {
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

    const chat = createChatModel(providerConfig, modelConfig);

    expect(chat.settings.reasoning).toBe('none');
  });

  it('keeps canonical minimal for GPT-5 models other than 5.1', () => {
    const providerConfig: ProviderConfig = {
      apiKey: 'sk-test',
      type: ProviderTypeEnum.OpenAI,
    };
    const modelConfig: ModelConfig = {
      provider: ProviderTypeEnum.OpenAI,
      modelName: 'gpt-5',
      reasoningEffort: 'minimal',
    };

    const chat = createChatModel(providerConfig, modelConfig);

    expect(chat.settings.reasoning).toBe('minimal');
  });

  it('keeps sampling parameters for non-reasoning models', () => {
    const chat = createChatModel(
      { apiKey: 'sk-test', type: ProviderTypeEnum.CustomOpenAI, baseUrl: 'https://example.test/v1' },
      { provider: 'custom_openai_2', modelName: 'mimo-v2.6-pro', parameters: { temperature: 0.2, topP: 0.3 } },
    );

    expect(chat.settings).toEqual({ temperature: 0.2, topP: 0.3, maxOutputTokens: 4096 });
    expect(chat.provider).toBe('custom_openai_2');
  });
});
