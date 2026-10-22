import { createLogger } from '../log';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
export function registerDebuggerListener(): void {
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
    }
  });
}
