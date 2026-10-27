import { AgentNameEnum, agentModelStore, llmProviderStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { AssistantTaskOptions } from '@extension/shared';
import type { ChatModel } from '../agent/helper';
import { createFailoverChatModel } from './model-failover-store';

/**
 * Builds the chat model configured for the navigator or planner slot, used by chat and plan modes.
 * Callers run it through runWithFailover so another configured model answers when this one fails.
 */
export async function loadAssistantModel(modelAgent: AssistantTaskOptions['modelAgent']): Promise<ChatModel> {
  const [models, providers] = await Promise.all([
    agentModelStore.getAllAgentModels(),
    llmProviderStore.getAllProviders(),
  ]);
  const slot = modelAgent === 'planner' ? AgentNameEnum.Planner : AgentNameEnum.Navigator;
  const config = models[slot];
  if (!config) throw new Error(t('bg_task_noModel'));
  if (!providers[config.provider]) throw new Error(t('bg_task_providerMissing'));
  return createFailoverChatModel(slot, config, providers);
}
