import type { BrowserInputPayload } from '@extension/shared';
import type AgentBrowserContext from '../browser/agent-browser/context';
import { createLogger } from '../log';
import { agentBrowserCompanionClient } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');

export async function startAgentBrowserStream(sessionId: string): Promise<void> {
  await agentBrowserCompanionClient.request(sessionId, sessionId, {
    action: 'start_screencast',
    screencastFormat: 'jpeg',
    screencastQuality: 80,
    screencastMaxWidth: 1280,
    screencastMaxHeight: 720,
    screencastEveryNthFrame: 1,
  });
}

export async function stopAgentBrowserStream(sessionId: string): Promise<void> {
  try {
    await agentBrowserCompanionClient.request(sessionId, sessionId, {
      action: 'stop_screencast',
    });
  } catch (error) {
    logger.debug('Ignoring stop stream error', error);
  }
}

export async function syncAgentBrowserToTabUrl(context: AgentBrowserContext, tabId: number): Promise<void> {
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

export async function forwardBrowserInput(input: BrowserInputPayload, sessionId?: string): Promise<void> {
  let effectiveSessionId = sessionId?.trim();
  if (!effectiveSessionId) {
    const { currentExecutor } = runtimeStore.getState();
    if (currentExecutor) {
      effectiveSessionId = await currentExecutor.getCurrentTaskId();
    }
  }
  await agentBrowserCompanionClient.sendInput({
    ...input,
    ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
  });
}
