import { createLogger } from '../log';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');

// Listen for debugger detached event.
// canceled_by_user stops the task; any other reason (renderer crash, target closed) drops the dead page
// so the next step attaches the tab again instead of failing on it until the task ends.
export function registerDebuggerListener(): void {
  // Firefox has no chrome.debugger; the content-script engine never attaches one.
  if (!chrome.debugger) return;
  chrome.debugger.onDetach.addListener(async (source, reason) => {
    if (isAgentBrowserContext(browserContext)) {
      return;
    }
    logger.info('Debugger detached:', source, reason);
    if (reason === 'canceled_by_user') {
      if (source.tabId) {
        const { currentExecutor, resetOverlay, setExecutor } = runtimeStore.getState();
        currentExecutor?.cancel();
        setExecutor(null);
        resetOverlay();
        await browserContext.cleanup();
      }
      return;
    }
    if (source.tabId) browserContext.removeAttachedPage(source.tabId);
  });
}
