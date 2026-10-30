import { createLogger } from '../log';
import { sendOverlayMessage } from '../overlay/overlayMessaging';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');
const OVERLAY_REINJECT_DELAY_MS = 500;
const pendingOverlayReinjects = new Map<number, ReturnType<typeof setTimeout>>();

/** Cancels the pending overlay re-injection for a tab, if any. */
function cancelOverlayReinject(tabId: number): void {
  const timer = pendingOverlayReinjects.get(tabId);
  if (timer === undefined) return;
  clearTimeout(timer);
  pendingOverlayReinjects.delete(tabId);
}

export function registerTabListeners(): void {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // A newer update supersedes any re-injection scheduled by an earlier 'complete'.
    cancelOverlayReinject(tabId);
    if (isAgentBrowserContext(browserContext)) {
      return;
    }
    // ponytail: buildDomTree.js is injected lazily by the DOM service when a task reads the page,
    // never eagerly into every tab the user browses.
    if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
      // Re-inject overlay if this tab is being controlled by an active agent
      const { overlayDriver, overlayStatusText, overlayTabId, overlayVisible } = runtimeStore.getState();
      if (overlayVisible && overlayTabId === tabId) {
        // Wait a bit for the content script to be ready
        const timer = setTimeout(() => {
          pendingOverlayReinjects.delete(tabId);
          sendOverlayMessage(tabId, { type: 'qagent:overlay:show', driver: overlayDriver });
          sendOverlayMessage(tabId, { type: 'qagent:overlay:mode', mode: runtimeStore.getState().overlayMode });
          if (overlayStatusText) {
            sendOverlayMessage(tabId, {
              type: 'qagent:overlay:status',
              text: overlayStatusText,
            });
          }
        }, OVERLAY_REINJECT_DELAY_MS);
        pendingOverlayReinjects.set(tabId, timer);
      }
    }
  });

  // Cleanup when tab is closed
  chrome.tabs.onRemoved.addListener(tabId => {
    cancelOverlayReinject(tabId);
    void browserContext.detachPage(tabId).catch(error => {
      logger.warning('Failed to detach tab after removal', tabId, error);
      browserContext.removeAttachedPage(tabId);
    });
  });
}
