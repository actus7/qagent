import {
  agentModelStore,
  AgentNameEnum,
  generalSettingsStore,
  llmProviderStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import type { AssistantAttachment, AssistantTaskOptions } from '@extension/shared';
import { Executor } from '../agent/executor';
import { type ChatModel, createChatModel } from '../agent/helper';
import { createLogger } from '../log';
import type { BrowserContextLike } from '../browser/types';
import { isAgentBrowserContext } from '../state/browserSession';

const logger = createLogger('background');

export async function setupExecutor(
  taskId: string,
  task: string,
  browserContext: BrowserContextLike,
  options: AssistantTaskOptions = {},
  attachments?: AssistantAttachment[],
) {
  const usingAgentBrowser = isAgentBrowserContext(browserContext);
  if (usingAgentBrowser) {
    browserContext.setSessionId(taskId);
  }

  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const navigatorModel =
    agentModels[options.modelAgent === 'planner' ? AgentNameEnum.Planner : AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: ChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  const generalSettings = await generalSettingsStore.getSettings();
  const useVision = usingAgentBrowser ? true : generalSettings.useVision;
  const useVisionForPlanner = usingAgentBrowser ? true : generalSettings.useVisionForPlanner;
  const displayHighlights = usingAgentBrowser ? true : generalSettings.displayHighlights;

  if (usingAgentBrowser && (!generalSettings.useVision || !generalSettings.useVisionForPlanner)) {
    logger.info('Forcing vision mode for BrowserManager tasks', {
      previousUseVision: generalSettings.useVision,
      previousUseVisionForPlanner: generalSettings.useVisionForPlanner,
    });
  }

  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights,
  });

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    navigatorProvider: navigatorModel.provider,
    plannerProvider: plannerModel?.provider ?? navigatorModel.provider,
    navigatorRequestsPerMinute: navigatorModel.requestsPerMinute,
    plannerRequestsPerMinute: plannerModel?.requestsPerMinute,
    navigatorRateLimitKey: `${navigatorModel.provider}:${navigatorModel.modelName}`,
    plannerRateLimitKey: `${plannerModel?.provider ?? navigatorModel.provider}:${plannerModel?.modelName ?? navigatorModel.modelName}`,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision,
      useVisionForPlanner,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: generalSettings,
    attachments,
  });

  return executor;
}
