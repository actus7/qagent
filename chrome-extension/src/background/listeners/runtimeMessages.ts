import { t } from '@extension/i18n';
import { isBackgroundRuntimeMessage } from '@extension/shared';
import { createLogger } from '../log';
import { browserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
import { cancelActiveTask } from '../task/taskRunner';
import { testProviderConnection } from '../services/provider-test';
import { runScheduledTask } from '../services/scheduling/runner';
import { readStepScreenshots } from '../services/step-screenshots';

const logger = createLogger('background');

// Extension pages only. Content scripts run in web pages, so their sender URL is not an extension URL, and
// sender.tab cannot tell the two apart because extension pages opened in a tab also carry it.
const isExtensionPageSender = (sender: chrome.runtime.MessageSender): boolean =>
  Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));

// Listen for simple messages (e.g., from options page or overlay cancel button)
export function registerRuntimeMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages and content scripts may drive the background
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (!isBackgroundRuntimeMessage(message)) {
      return false;
    }

    if (message?.type === 'qagent:cancel') {
      const { currentExecutor } = runtimeStore.getState();
      if (currentExecutor) {
        void cancelActiveTask();
        logger.info('Task cancelled via overlay stop button');
      }
      sendResponse({ ok: true });
      return false;
    }

    // Options page: one minimal request through a saved provider. Extension pages only, never content scripts.
    if (message?.type === 'qagent:test-provider') {
      if (sender.tab) return false;
      testProviderConnection(message.providerId)
        .then(result => sendResponse(result))
        .catch(() => sendResponse({ ok: false, error: t('options_test_failed') }));
      return true;
    }

    // Extension pages ask for an immediate run of a scheduled task; the run continues after the reply.
    if (message?.type === 'qagent:schedule:run-now') {
      if (!isExtensionPageSender(sender)) return false;
      runScheduledTask(message.id).catch(error => logger.error(`Scheduled task ${message.id} crashed:`, error));
      sendResponse({ ok: true });
      return false;
    }

    // Report export asks for the stored step screenshots of a task; the reply is sent asynchronously.
    if (message?.type === 'qagent:step-screenshots:get') {
      if (!isExtensionPageSender(sender)) return false;
      readStepScreenshots(message.taskId)
        .then(screenshots => sendResponse({ screenshots }))
        .catch(error => {
          logger.error('Failed to read step screenshots:', error);
          sendResponse({ screenshots: [] });
        });
      return true;
    }

    // Content script asks the background for the current overlay state.
    if (message?.type === 'qagent:overlay:state') {
      const tabId = sender.tab?.id;
      const { currentExecutor, overlayStatusText, overlayVisible, overlayMode } = runtimeStore.getState();
      const shouldShowOverlay = Boolean(
        tabId && overlayVisible && currentExecutor && browserContext.currentTabId === tabId,
      );

      sendResponse({
        active: shouldShowOverlay,
        statusText: shouldShowOverlay ? overlayStatusText : null,
        mode: overlayMode,
      });
      return false;
    }

    return false;
  });
}
