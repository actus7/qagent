import { AgentNameEnum, agentModelStore, llmProviderStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { AssistantTaskOptions } from '@extension/shared';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createChatModel } from '../agent/helper';

/** Builds the chat model configured for the navigator or planner slot, used by chat and plan modes. */
export async function loadAssistantModel(modelAgent: AssistantTaskOptions['modelAgent']): Promise<BaseChatModel> {
  const models = await agentModelStore.getAllAgentModels();
  const config = models[modelAgent === 'planner' ? AgentNameEnum.Planner : AgentNameEnum.Navigator];
  if (!config) throw new Error(t('bg_task_noModel'));
  const providers = await llmProviderStore.getAllProviders();
  if (!providers[config.provider]) throw new Error(t('bg_task_providerMissing'));
  return createChatModel(providers[config.provider], config);
}
