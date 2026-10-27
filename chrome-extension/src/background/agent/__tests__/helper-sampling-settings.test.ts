import { describe, expect, it } from 'vitest';
import type { ModelConfig, ProviderConfig } from '@extension/storage';
import { ProviderTypeEnum } from '@extension/storage';
import { createChatModel } from '../helper';

const customProvider: ProviderConfig = {
  apiKey: 'key',
  baseUrl: 'http://localhost:8080/v1',
  type: ProviderTypeEnum.CustomOpenAI,
};

describe('createChatModel sampling settings by model name', () => {
  it('keeps sampling parameters for an OpenAI-compatible model whose name starts with "o"', () => {
    const modelConfig: ModelConfig = { provider: 'custom_openai', modelName: 'olmo-2' };

    const chat = createChatModel(customProvider, modelConfig);

    expect(chat.settings.temperature).toBe(0.1);
    expect(chat.settings.reasoning).toBeUndefined();
  });

  it('drops sampling parameters for an o-series reasoning model', () => {
    const modelConfig: ModelConfig = { provider: ProviderTypeEnum.OpenAI, modelName: 'o3-mini' };

    const chat = createChatModel({ apiKey: 'sk-test', type: ProviderTypeEnum.OpenAI }, modelConfig);

    expect(chat.settings.temperature).toBeUndefined();
  });
});
