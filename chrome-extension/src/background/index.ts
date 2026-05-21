import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
} from '@extension/storage';
import { resolveLocale, t } from '@extension/i18n';
import AgentBrowserContext from './browser/agent-browser/context';
import { AgentBrowserCompanionClient } from './browser/agent-browser/client';
import { Executor } from './agent/executor';
import { createLogger, isVerboseLoggingEnabled, setVerboseLoggingEnabled, subscribeLogEntries } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import { runtimeStore } from './state/runtimeStore';
import {
  type BrowserInputPayload,
  isBackgroundRuntimeMessage,
  isSidePanelCommandMessage,
  SIDE_PANEL_CONNECTION_PORT_NAME,
  type SidePanelResponseMessage,
} from '@extension/shared';
import type { BrowserContextLike } from './browser/types';

const logger = createLogger('background');
// BrowserManager companion is the only supported browser engine.
const browserEngine = 'agent-browser';
const agentBrowserCompanionClient = new AgentBrowserCompanionClient({
  url: import.meta.env.VITE_AGENT_BROWSER_WS_URL || 'ws://127.0.0.1:9223',
  token: import.meta.env.VITE_AGENT_BROWSER_WS_TOKEN || undefined,
});
const browserContext: BrowserContextLike = new AgentBrowserContext({}, agentBrowserCompanionClient);
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');

function isAgentBrowserContext(context: BrowserContextLike): context is AgentBrowserContext {
  return context.getEngineName() === 'agent-browser-v1';
}

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isAgentBrowserContext(browserContext)) {
    return;
  }
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);

    // Re-inject overlay if this tab is being controlled by an active agent
    const { currentExecutor, overlayStatusText, overlayVisible } = runtimeStore.getState();
    if (overlayVisible && currentExecutor && browserContext.currentTabId === tabId) {
      // Wait a bit for the content script to be ready
      setTimeout(() => {
        sendOverlayMessage(tabId, { type: 'qagent:overlay:show' });
        if (overlayStatusText) {
          sendOverlayMessage(tabId, {
            type: 'qagent:overlay:status',
            text: overlayStatusText,
          });
        }
      }, 500);
    }
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (isAgentBrowserContext(browserContext)) {
    return;
  }
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      const { currentExecutor, resetOverlay, setExecutor } = runtimeStore.getState();
      currentExecutor?.cancel();
      setExecutor(null);
      resetOverlay();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  void browserContext.detachPage(tabId).catch(error => {
    logger.warning('Failed to detach tab after removal', tabId, error);
    browserContext.removeAttachedPage(tabId);
  });
});

logger.info('background loaded');
logger.info('browser engine', browserEngine);

agentBrowserCompanionClient.onStatus(status => {
  const { currentPort } = runtimeStore.getState();
  if (!currentPort) {
    return;
  }

  const message: SidePanelResponseMessage = {
    type: 'browser_status',
    status,
  };

  try {
    currentPort.postMessage(message);
  } catch {
    // Ignore port lifecycle races.
  }
});

agentBrowserCompanionClient.onFrame(frame => {
  const { currentPort } = runtimeStore.getState();
  if (!currentPort) {
    return;
  }

  const message: SidePanelResponseMessage = {
    type: 'browser_frame',
    frame,
  };

  try {
    currentPort.postMessage(message);
  } catch {
    // Ignore port lifecycle races.
  }
});

subscribeLogEntries(entry => {
  if (!isVerboseLoggingEnabled()) {
    return;
  }

  const { currentPort } = runtimeStore.getState();
  if (!currentPort) {
    return;
  }

  try {
    const debugMessage: SidePanelResponseMessage = {
      type: 'debug_log',
      entry,
    };
    currentPort.postMessage(debugMessage);
  } catch {
    // Ignore forwarding errors. Port lifecycle is handled elsewhere.
  }
});

const syncLanguageFromSettings = async () => {
  try {
    const settings = await generalSettingsStore.getSettings();
    t.devLocale = resolveLocale(settings.language);
    setVerboseLoggingEnabled(settings.chatDebugMode);
  } catch (error) {
    logger.warning('Failed to load language settings for background i18n', error);
    setVerboseLoggingEnabled(false);
  }
};

void syncLanguageFromSettings();

generalSettingsStore.subscribe(() => {
  const settings = generalSettingsStore.getSnapshot();
  if (!settings) {
    return;
  }
  t.devLocale = resolveLocale(settings.language);
  setVerboseLoggingEnabled(settings.chatDebugMode);
});

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Listen for simple messages (e.g., from options page or overlay cancel button)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isBackgroundRuntimeMessage(message)) {
    return false;
  }

  if (message?.type === 'qagent:cancel') {
    const { currentExecutor } = runtimeStore.getState();
    if (currentExecutor) {
      currentExecutor.cancel();
      logger.info('Task cancelled via overlay stop button');
    }
    sendResponse({ ok: true });
    return false;
  }

  // Content script asks the background for the current overlay state.
  if (message?.type === 'qagent:overlay:state') {
    const tabId = sender.tab?.id;
    const { currentExecutor, overlayStatusText, overlayVisible } = runtimeStore.getState();
    const shouldShowOverlay = Boolean(
      tabId && overlayVisible && currentExecutor && browserContext.currentTabId === tabId,
    );

    sendResponse({
      active: shouldShowOverlay,
      statusText: shouldShowOverlay ? overlayStatusText : null,
    });
    return false;
  }

  return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === SIDE_PANEL_CONNECTION_PORT_NAME) {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    runtimeStore.getState().setPort(port);
    const postPortMessage = (payload: SidePanelResponseMessage) => port.postMessage(payload);

    port.onMessage.addListener(async incomingMessage => {
      if (!isSidePanelCommandMessage(incomingMessage)) {
        const unknownType =
          typeof incomingMessage === 'object' &&
          incomingMessage !== null &&
          'type' in incomingMessage &&
          typeof (incomingMessage as { type?: unknown }).type === 'string'
            ? (incomingMessage as { type: string }).type
            : 'unknown';
        return postPortMessage({ type: 'error', error: t('errors_cmd_unknown', [unknownType]) });
      }

      const message = incomingMessage;
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            postPortMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            logger.info('new_task', message.tabId, message.task);

            // Ensure we attach to the correct tab before starting
            // This sets _currentTabId so overlay messages go to the right place
            await browserContext.switchTab(message.tabId);
            if (isAgentBrowserContext(browserContext)) {
              browserContext.setSessionId(message.taskId);
            }

            const executor = await setupExecutor(message.taskId, message.task, browserContext);
            if (isAgentBrowserContext(browserContext)) {
              await syncAgentBrowserToTabUrl(browserContext, message.tabId);
              await startAgentBrowserStream(message.taskId);
            }
            runtimeStore.getState().setExecutor(executor);
            subscribeToExecutorEvents(executor);

            const result = await executor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            logger.info('follow_up_task', message.tabId, message.task);
            if (isAgentBrowserContext(browserContext)) {
              browserContext.setSessionId(message.taskId);
            }

            // If executor exists, add follow-up task
            const { currentExecutor } = runtimeStore.getState();
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);
              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return postPortMessage({ type: 'error', error: t('bg_cmd_followUpTask_cleaned') });
            }
            break;
          }

          case 'cancel_task': {
            const { currentExecutor } = runtimeStore.getState();
            if (!currentExecutor) return postPortMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.cancel();
            if (isAgentBrowserContext(browserContext)) {
              const taskId = await currentExecutor.getCurrentTaskId();
              await stopAgentBrowserStream(taskId);
            }
            break;
          }

          case 'resume_task': {
            const { currentExecutor } = runtimeStore.getState();
            if (!currentExecutor) return postPortMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await currentExecutor.resume();
            return postPortMessage({ type: 'success' });
          }

          case 'pause_task': {
            const { currentExecutor } = runtimeStore.getState();
            if (!currentExecutor) return postPortMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.pause();
            return postPortMessage({ type: 'success' });
          }

          case 'screenshot': {
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return postPortMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return postPortMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return postPortMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return postPortMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'speech_to_text': {
            try {
              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return postPortMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return postPortMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
          }

          case 'browser_input': {
            try {
              await forwardBrowserInput(message.input, message.sessionId);
              return postPortMessage({ type: 'success' });
            } catch (error) {
              return postPortMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to forward browser input',
              });
            }
          }

          case 'replay': {
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);
              if (isAgentBrowserContext(browserContext)) {
                browserContext.setSessionId(message.taskId);
              }
              // Setup executor with the new taskId and a dummy task description
              const executor = await setupExecutor(message.taskId, message.task, browserContext);
              if (isAgentBrowserContext(browserContext)) {
                await syncAgentBrowserToTabUrl(browserContext, message.tabId);
                await startAgentBrowserStream(message.taskId);
              }
              runtimeStore.getState().setExecutor(executor);
              subscribeToExecutorEvents(executor);

              // Run replayHistory with the history session ID
              const result = await executor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return postPortMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        postPortMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      const { currentExecutor, resetOverlay, setPort } = runtimeStore.getState();
      if (!isAgentBrowserContext(browserContext)) {
        sendOverlayMessage(browserContext.currentTabId, { type: 'qagent:overlay:hide' });
      }
      setPort(null);
      if (currentExecutor) {
        void currentExecutor.cancel();
        if (isAgentBrowserContext(browserContext)) {
          void currentExecutor
            .getCurrentTaskId()
            .then(taskId => stopAgentBrowserStream(taskId))
            .catch(() => {});
        }
      }
      resetOverlay();
    });
  }
});

async function startAgentBrowserStream(sessionId: string): Promise<void> {
  await agentBrowserCompanionClient.request(sessionId, sessionId, {
    action: 'start_screencast',
    screencastFormat: 'jpeg',
    screencastQuality: 80,
    screencastMaxWidth: 1280,
    screencastMaxHeight: 720,
    screencastEveryNthFrame: 1,
  });
}

async function stopAgentBrowserStream(sessionId: string): Promise<void> {
  try {
    await agentBrowserCompanionClient.request(sessionId, sessionId, {
      action: 'stop_screencast',
    });
  } catch (error) {
    logger.debug('Ignoring stop stream error', error);
  }
}

async function forwardBrowserInput(input: BrowserInputPayload, sessionId?: string): Promise<void> {
  let effectiveSessionId = sessionId?.trim();
  if (!effectiveSessionId) {
    const { currentExecutor } = runtimeStore.getState();
    if (currentExecutor) {
      effectiveSessionId = await currentExecutor.getCurrentTaskId();
    }
  }
  if (input.type === 'input_mouse') {
    await agentBrowserCompanionClient.sendInput({
      ...input,
      ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
    });
    return;
  }

  if (input.type === 'input_keyboard') {
    await agentBrowserCompanionClient.sendInput({
      ...input,
      ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
    });
    return;
  }

  await agentBrowserCompanionClient.sendInput({
    ...input,
    ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
  });
}

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContextLike) {
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

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
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
  });

  return executor;
}

async function syncAgentBrowserToTabUrl(context: AgentBrowserContext, tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url?.trim() ?? '';
    if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
      logger.debug('Skipping BrowserManager URL sync for unsupported tab URL', { tabId, tabUrl });
      return;
    }

    await context.navigateTo(tabUrl);
    logger.info('Synchronized BrowserManager preview with active tab URL', { tabId, tabUrl });
  } catch (error) {
    logger.warning('Failed to synchronize BrowserManager preview with active tab URL', { tabId, error });
  }
}

const OVERLAY_RECEIVER_MISSING_ERROR = 'Could not establish connection. Receiving end does not exist.';
const overlayInjectionInFlight = new Set<number>();

function isOverlayReceiverMissingError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === 'string') {
    return error.includes(OVERLAY_RECEIVER_MISSING_ERROR);
  }

  if (error instanceof Error) {
    return error.message.includes(OVERLAY_RECEIVER_MISSING_ERROR);
  }

  const maybeMessage = (error as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.includes(OVERLAY_RECEIVER_MISSING_ERROR);
}

async function canInjectOverlayIntoTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url?.trim().toLowerCase() ?? '';

    // Keep this aligned with Page valid web page constraints.
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return false;
    }

    if (url.startsWith('https://chromewebstore.google.com')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function injectOverlayReceiver(tabId: number): Promise<boolean> {
  if (overlayInjectionInFlight.has(tabId)) {
    return false;
  }

  if (!(await canInjectOverlayIntoTab(tabId))) {
    return false;
  }

  overlayInjectionInFlight.add(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.iife.js'],
    });
    return true;
  } catch (error) {
    logger.debug('sendOverlayMessage: Overlay reinjection skipped', error);
    return false;
  } finally {
    overlayInjectionInFlight.delete(tabId);
  }
}

// Send a message to the active tab's content script for overlay updates
function sendOverlayMessage(tabId: number | null, message: Record<string, unknown>) {
  if (!tabId) {
    logger.warning('sendOverlayMessage: No tabId');
    return;
  }

  chrome.tabs.sendMessage(tabId, message).catch(async error => {
    if (!isOverlayReceiverMissingError(error)) {
      logger.warning('sendOverlayMessage: Failed to send', error);
      return;
    }

    // Expected in tabs without content script. Attempt a one-shot reinjection for valid web pages.
    const injected = await injectOverlayReceiver(tabId);
    if (!injected) {
      return;
    }

    chrome.tabs.sendMessage(tabId, message).catch(retryError => {
      if (!isOverlayReceiverMissingError(retryError)) {
        logger.warning('sendOverlayMessage: Failed to send after reinjection', retryError);
      }
    });
  });
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Reset overlay status for new task
  runtimeStore.getState().setOverlayStatusText(null);

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      const { currentPort } = runtimeStore.getState();
      if (currentPort) {
        const executionMessage: SidePanelResponseMessage = {
          type: 'execution',
          actor: event.actor,
          state: event.state,
          data: event.data,
          timestamp: event.timestamp,
        };
        currentPort.postMessage(executionMessage);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    // Forward relevant events to the content script overlay only for chrome debugger mode.
    if (!isAgentBrowserContext(browserContext)) {
      const tabId = browserContext.currentTabId;

      switch (event.state) {
        case ExecutionState.TASK_START:
          runtimeStore.getState().setOverlayStatusText(t('sidepanel_progress_message'));
          runtimeStore.getState().setOverlayVisible(true);
          sendOverlayMessage(tabId, { type: 'qagent:overlay:show' });
          sendOverlayMessage(tabId, {
            type: 'qagent:overlay:status',
            text: t('sidepanel_progress_message'),
          });
          break;
        case ExecutionState.TASK_OK:
        case ExecutionState.TASK_FAIL:
        case ExecutionState.TASK_CANCEL:
          runtimeStore.getState().resetOverlay();
          sendOverlayMessage(tabId, { type: 'qagent:overlay:hide' });
          break;
        case ExecutionState.ACT_START: {
          const statusText = event.data?.details || 'Working…';
          runtimeStore.getState().setOverlayStatusText(statusText);
          sendOverlayMessage(tabId, {
            type: 'qagent:overlay:status',
            text: statusText,
          });
          break;
        }
      }
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      if (isAgentBrowserContext(browserContext)) {
        await stopAgentBrowserStream(event.data.taskId);
      }
      await executor.cleanup();

      const { currentExecutor, setExecutor } = runtimeStore.getState();
      if (currentExecutor === executor) {
        setExecutor(null);
      }
    }
  });
}
