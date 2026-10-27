import { agentModelStore, type AgentNameEnum, type ModelConfig, type ProviderConfig } from '@extension/storage';
import { isManagedProviderAllowed } from '@extension/shared';
import { type ChatModel, createChatModel } from '../agent/helper';
import { ModelFailover, type ModelHealth, orderCandidates } from '../agent/model-failover';
import { createLogger } from '../log';
import { getManagedPolicy } from '../state/managedPolicyState';

const logger = createLogger('model-failover');
const HEALTH_STORAGE_KEY = 'model-health';

async function loadHealth(): Promise<ModelHealth> {
  try {
    const stored = await chrome.storage.local.get(HEALTH_STORAGE_KEY);
    const value = stored[HEALTH_STORAGE_KEY];
    return value && typeof value === 'object' ? (value as ModelHealth) : {};
  } catch (error) {
    logger.warning('Could not read model health; starting without it', error);
    return {};
  }
}

async function saveHealth(health: ModelHealth): Promise<void> {
  await chrome.storage.local.set({ [HEALTH_STORAGE_KEY]: health });
}

/**
 * The chat model for `slot`, able to fall back to every other configured model the managed policy allows.
 * With a single usable model it behaves like a plain createChatModel.
 */
export async function createFailoverChatModel(
  slot: AgentNameEnum,
  primary: ModelConfig,
  providers: Record<string, ProviderConfig>,
): Promise<ChatModel> {
  const policy = getManagedPolicy();
  const allowed = Object.fromEntries(
    Object.entries(providers).filter(([id, config]) => isManagedProviderAllowed({ id, type: config.type }, policy)),
  );
  const health = await loadHealth();
  const candidates = orderCandidates(primary, allowed, health);
  if (candidates.length <= 1) return createChatModel(providers[primary.provider], primary);

  const failover = new ModelFailover(slot, candidates, health, {
    createChatModel,
    persistSlotModel: async (agent, config) => {
      await agentModelStore.setAgentModel(agent, config);
      logger.info(`Model for ${agent} switched to ${config.provider}:${config.modelName} after a failure`);
    },
    saveHealth,
  });
  return failover.primaryModel;
}
