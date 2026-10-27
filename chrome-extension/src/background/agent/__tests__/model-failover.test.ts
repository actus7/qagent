import { describe, expect, it, vi } from 'vitest';
import type { ModelConfig, ProviderConfig } from '@extension/storage';
import { AgentNameEnum, ProviderTypeEnum } from '@extension/storage';
import { ModelFailover, orderCandidates, runWithFailover, type ModelHealth } from '../model-failover';
import type { ChatModel } from '../helper';

const providers: Record<string, ProviderConfig> = {
  openai: { type: ProviderTypeEnum.OpenAI, apiKey: 'k1', modelNames: ['gpt-a', 'gpt-b'] },
  anthropic: { type: ProviderTypeEnum.Anthropic, apiKey: 'k2', modelNames: ['claude-a'] },
  nokey: { type: ProviderTypeEnum.Gemini, apiKey: '', modelNames: ['gemini-a'] },
};
const primary: ModelConfig = { provider: 'openai', modelName: 'gpt-a' };

function build(health: ModelHealth = {}) {
  const persisted: ModelConfig[] = [];
  const failover = new ModelFailover(AgentNameEnum.Navigator, orderCandidates(primary, providers, health), health, {
    createChatModel: (_p, config) => ({
      model: {} as never,
      modelName: config.modelName,
      provider: config.provider,
      settings: {},
    }),
    persistSlotModel: async (_slot, config) => {
      persisted.push(config);
    },
    saveHealth: async () => {},
  });
  return { failover, persisted };
}

const names = (models: ChatModel[]) => models.map(m => m.modelName);

describe('orderCandidates', () => {
  it('puts the configured model first and skips providers without an API key', () => {
    expect(orderCandidates(primary, providers, {}).map(c => c.key)).toEqual([
      'openai:gpt-a',
      'openai:gpt-b',
      'anthropic:claude-a',
    ]);
  });

  it('orders the other models by past success', () => {
    const health: ModelHealth = { 'anthropic:claude-a': { ok: 3, fail: 0, lastOk: 10 } };
    expect(orderCandidates(primary, providers, health).map(c => c.key)).toEqual([
      'openai:gpt-a',
      'anthropic:claude-a',
      'openai:gpt-b',
    ]);
  });
});

describe('runWithFailover', () => {
  it('tries the next model when one fails and makes the working one the configured model', async () => {
    const { failover, persisted } = build();
    const run = vi.fn(async (model: ChatModel) => {
      if (model.modelName === 'gpt-a') throw new Error('401 invalid api key');
      return model.modelName;
    });

    const result = await runWithFailover(failover.primaryModel, run, { shouldTryNext: () => true });

    expect(result).toBe('gpt-b');
    expect(persisted).toEqual([{ provider: 'openai', modelName: 'gpt-b' }]);
    // the model that worked is tried first next time; the failed one goes last
    expect(names(failover.attemptOrder())).toEqual(['gpt-b', 'claude-a', 'gpt-a']);
  });

  it('keeps the default configuration and throws the first error when every model fails', async () => {
    const { failover, persisted } = build();
    const switched: string[] = [];

    await expect(
      runWithFailover(
        failover.primaryModel,
        async model => {
          throw new Error(`down: ${model.modelName}`);
        },
        { shouldTryNext: () => true, onSwitch: model => switched.push(model.modelName) },
      ),
    ).rejects.toThrow('down: gpt-a');

    expect(persisted).toEqual([]);
    expect(switched).toEqual(['gpt-b', 'claude-a', 'gpt-a']);
    expect(failover.attemptOrder()[0].modelName).toBe('gpt-a');
  });

  it('does not try other models for errors no model can fix', async () => {
    const { failover } = build();
    const run = vi.fn(async () => {
      throw new Error('cancelled');
    });

    await expect(runWithFailover(failover.primaryModel, run, { shouldTryNext: () => false })).rejects.toThrow(
      'cancelled',
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
