import { createLogger } from '../log';
import { sendOverlayMessage } from '../overlay/overlayMessaging';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');

export function registerTabListeners(): void {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (isAgentBrowserContext(browserContext)) {
      return;
    }
    // ponytail: buildDomTree.js is injected lazily by the DOM service when a task reads the page,
    // never eagerly into every tab the user browses.
    if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
      // Re-inject overlay if this tab is being controlled by an active agent
      const { currentExecutor, overlayStatusText, overlayVisible } = runtimeStore.getState();
      if (overlayVisible && currentExecutor && browserContext.currentTabId === tabId) {
        // Wait a bit for the content script to be ready
        setTimeout(() => {
          sendOverlayMessage(tabId, { type: 'qagent:overlay:show' });
          sendOverlayMessage(tabId, { type: 'qagent:overlay:mode', mode: runtimeStore.getState().overlayMode });
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

  // Cleanup when tab is closed
  chrome.tabs.onRemoved.addListener(tabId => {
    void browserContext.detachPage(tabId).catch(error => {
      logger.warning('Failed to detach tab after removal', tabId, error);
      browserContext.removeAttachedPage(tabId);
    });
  });
}
