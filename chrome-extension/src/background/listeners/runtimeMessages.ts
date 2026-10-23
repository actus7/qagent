import { isBackgroundRuntimeMessage } from '@extension/shared';
import { createLogger } from '../log';
import { browserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
import { cancelActiveTask } from '../task/taskRunner';

const logger = createLogger('background');

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
}
