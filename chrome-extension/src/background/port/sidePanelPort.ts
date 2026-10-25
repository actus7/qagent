import { t } from '@extension/i18n';
import {
  isSidePanelCommandMessage,
  SIDE_PANEL_CONNECTION_PORT_NAME,
  type SidePanelResponseMessage,
} from '@extension/shared';
import { sendOverlayMessage } from '../overlay/overlayMessaging';
import { createLogger } from '../log';
import { openAgentPanel } from '../services/agent-panel';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
import { cancelActiveTask } from '../task/taskRunner';
import { routeSidePanelCommand } from './commandRouter';

const logger = createLogger('background');
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');

export function setupSidePanelBehavior(): void {
  if (!chrome.sidePanel) {
    // Firefox has no side panel: the toolbar button opens the sidebar_action instead.
    chrome.action.onClicked.addListener(tab => {
      openAgentPanel(tab.windowId).catch(error => logger.warning('Could not open the sidebar', error));
    });
    return;
  }
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => logger.error(error));
}

function getMessageType(message: unknown): string {
  if (typeof message === 'object' && message !== null && 'type' in message) {
    const { type } = message as { type?: unknown };
    if (typeof type === 'string') return type;
  }
  return 'unknown';
}

// Setup connection listener for long-lived connections (e.g., side panel)
export function registerSidePanelPortListener(): void {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== SIDE_PANEL_CONNECTION_PORT_NAME) return;

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
        return postPortMessage({ type: 'error', error: t('errors_cmd_unknown', [getMessageType(incomingMessage)]) });
      }

      try {
        await routeSidePanelCommand(incomingMessage, postPortMessage);
      } catch (error) {
        logger.error('Error handling port message:', error);
        postPortMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      logger.info('Side panel disconnected');
      const { currentPort, resetOverlay, setPort } = runtimeStore.getState();
      if (currentPort !== port) return;
      if (!isAgentBrowserContext(browserContext)) {
        sendOverlayMessage(browserContext.currentTabId, { type: 'qagent:overlay:hide' });
      }
      setPort(null);
      void cancelActiveTask();
      resetOverlay();
    });
  });
}
