import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { llmProviderStore } from './llmProviders';
import { AgentNameEnum, getDefaultModelRequestsPerMinute, llmProviderParameters } from './types';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
const LEGACY_REASONING_EFFORT = 'minimal/none';

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
      return value;
    case LEGACY_REASONING_EFFORT:
      return 'minimal';
    default:
      return undefined;
  }
}

// Interface for a single model configuration
export interface ModelConfig {
  // providerId, the key of the provider in the llmProviderStore, not the provider name
  provider: string;
  modelName: string;
  parameters?: Record<string, unknown>;
  requestsPerMinute?: number;
  reasoningEffort?: ReasoningEffort; // For o-series models (OpenAI and Azure)
}

// Interface for storing multiple agent model configurations
interface AgentModelRecord {
  agents: Record<AgentNameEnum, ModelConfig>;
}

type AgentModelStorage = BaseStorage<AgentModelRecord> & {
  setAgentModel: (agent: AgentNameEnum, config: ModelConfig) => Promise<void>;
  getAgentModel: (agent: AgentNameEnum) => Promise<ModelConfig | undefined>;
  resetAgentModel: (agent: AgentNameEnum) => Promise<void>;
  hasAgentModel: (agent: AgentNameEnum) => Promise<boolean>;
  getConfiguredAgents: () => Promise<AgentNameEnum[]>;
  getAllAgentModels: () => Promise<Record<AgentNameEnum, ModelConfig>>;
  /** Resets every agent using `providerId` whose model is not in `keepModelNames`. Returns the reset agents. */
  resetAgentModelsForProvider: (providerId: string, keepModelNames: string[]) => Promise<AgentNameEnum[]>;
  cleanupLegacyValidatorSettings: () => Promise<void>;
};

const storage = createStorage<AgentModelRecord>(
  'agent-models',
  { agents: {} as Record<AgentNameEnum, ModelConfig> },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

function validateModelConfig(config: ModelConfig) {
  if (!config.provider || !config.modelName) {
    throw new Error('Provider and model name must be specified');
  }
}

function getModelParameters(agent: AgentNameEnum, provider: string): Record<string, unknown> {
  const providerParams = llmProviderParameters[provider as keyof typeof llmProviderParameters]?.[agent];
  return providerParams ?? { temperature: 0.1, topP: 0.1 };
}

function normalizeRequestsPerMinute(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.round(value);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

export const agentModelStore: AgentModelStorage = {
  ...storage,
  setAgentModel: async (agent: AgentNameEnum, config: ModelConfig) => {
    validateModelConfig(config);
    const normalizedReasoningEffort = normalizeReasoningEffort(config.reasoningEffort);
    // Merge default parameters with provided parameters
    const defaultParams = getModelParameters(agent, config.provider);
    const mergedConfig = {
      ...config,
      parameters: {
        ...defaultParams,
        ...config.parameters,
      },
      requestsPerMinute:
        normalizeRequestsPerMinute(config.requestsPerMinute) ??
        getDefaultModelRequestsPerMinute(config.provider, config.modelName),
      reasoningEffort: normalizedReasoningEffort,
    };
    await storage.set(current => ({
      agents: {
        ...current.agents,
        [agent]: mergedConfig,
      },
    }));
  },
  getAgentModel: async (agent: AgentNameEnum) => {
    const data = await storage.get();
    const config = data.agents[agent];
    if (!config) return undefined;

    // Merge default parameters with stored parameters
    const defaultParams = getModelParameters(agent, config.provider);
    const normalizedReasoningEffort = normalizeReasoningEffort(config.reasoningEffort);
    return {
      ...config,
      parameters: {
        ...defaultParams,
        ...config.parameters,
      },
      requestsPerMinute:
        normalizeRequestsPerMinute(config.requestsPerMinute) ??
        getDefaultModelRequestsPerMinute(config.provider, config.modelName),
      reasoningEffort: normalizedReasoningEffort,
    };
  },
  resetAgentModel: async (agent: AgentNameEnum) => {
    await storage.set(current => {
      const newAgents = { ...current.agents };
      delete newAgents[agent];
      return { agents: newAgents };
    });
  },
  hasAgentModel: async (agent: AgentNameEnum) => {
    const data = await storage.get();
    return agent in data.agents;
  },
  getConfiguredAgents: async () => {
    const data = await storage.get();
    const providerIds = new Set(Object.keys(await llmProviderStore.getAllProviders()));
    // Filter out legacy validator entries and agents whose provider was deleted
    return Object.keys(data.agents).filter(
      agentKey =>
        agentKey !== 'validator' &&
        Object.values(AgentNameEnum).includes(agentKey as AgentNameEnum) &&
        providerIds.has(data.agents[agentKey as AgentNameEnum].provider),
    ) as AgentNameEnum[];
  },
  resetAgentModelsForProvider: async (providerId: string, keepModelNames: string[]) => {
    const data = await storage.get();
    const resetAgents = (Object.keys(data.agents) as AgentNameEnum[]).filter(agent => {
      const config = data.agents[agent];
      return config.provider === providerId && !keepModelNames.includes(config.modelName);
    });
    if (resetAgents.length === 0) {
      return [];
    }
    await storage.set(current => {
      const newAgents = { ...current.agents };
      for (const agent of resetAgents) {
        delete newAgents[agent];
      }
      return { agents: newAgents };
    });
    return resetAgents;
  },
  getAllAgentModels: async () => {
    const data = await storage.get();
    // Filter out any legacy validator entries for backward compatibility
    const filteredAgents: Partial<Record<AgentNameEnum, ModelConfig>> = {};
    for (const [agentKey, config] of Object.entries(data.agents)) {
      if (agentKey !== 'validator' && Object.values(AgentNameEnum).includes(agentKey as AgentNameEnum)) {
        filteredAgents[agentKey as AgentNameEnum] = {
          ...config,
          requestsPerMinute:
            normalizeRequestsPerMinute(config.requestsPerMinute) ??
            getDefaultModelRequestsPerMinute(config.provider, config.modelName),
          reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
        };
      }
    }
    return filteredAgents as Record<AgentNameEnum, ModelConfig>;
  },
  cleanupLegacyValidatorSettings: async () => {
    // runs at every task start: only write when there is something to remove
    const current = await storage.get();
    if (!('validator' in (current.agents ?? {}))) return;
    await storage.set(current => {
      const newAgents = { ...current.agents };
      delete newAgents['validator' as keyof typeof newAgents];
      return { agents: newAgents };
    });
  },
};
