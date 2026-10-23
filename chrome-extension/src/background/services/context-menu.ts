import { t } from '@extension/i18n';
import {
  CONTEXT_PREFILL_STORAGE_KEY,
  isContextPrefillPayload,
  isHttpUrl,
  MAX_SELECTION_LENGTH,
  type ContextPrefillPayload,
} from '@extension/shared';
import { createLogger } from '../log';

const logger = createLogger('background');

export const ASK_QAGENT_MENU_ID = 'qagent-ask-about-this';

interface ContextClickInfo {
  menuItemId: string | number;
  pageUrl?: string;
  selectionText?: string;
  linkUrl?: string;
  srcUrl?: string;
}

/** Builds and validates the prefill. Returns null when the click has no usable tab. */
export function buildContextPrefill(info: ContextClickInfo, tab: chrome.tabs.Tab | undefined): ContextPrefillPayload | null {
  if (tab?.id === undefined) return null;
  const selection = info.selectionText?.trim();
  const payload: ContextPrefillPayload = {
    tabId: tab.id,
    pageUrl: info.pageUrl ?? tab.url ?? '',
    pageTitle: tab.title ?? '',
    // Non-web links and data: images are dropped rather than rejecting the whole click.
    ...(selection ? { selectionText: selection.slice(0, MAX_SELECTION_LENGTH) } : {}),
    ...(isHttpUrl(info.linkUrl) ? { linkUrl: info.linkUrl } : {}),
    ...(isHttpUrl(info.srcUrl) ? { imageUrl: info.srcUrl } : {}),
  };
  return isContextPrefillPayload(payload) ? payload : null;
}

/**
 * Hands the prefill to the side panel through chrome.storage.session. The panel reads it when it mounts or,
 * if already open, through storage.onChanged, so nothing is lost when the panel was closed.
 */
export async function deliverContextPrefill(payload: ContextPrefillPayload): Promise<void> {
  await chrome.storage.session.set({
    [CONTEXT_PREFILL_STORAGE_KEY]: { payload, createdAt: Date.now() },
  });
}

async function handleAskClick(info: ContextClickInfo, tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (info.menuItemId !== ASK_QAGENT_MENU_ID) return;
  const payload = buildContextPrefill(info, tab);
  if (!payload) {
    logger.warning('Ask QAgent: click without a usable tab');
    return;
  }
  // sidePanel.open needs the user gesture, so it is called before any other await.
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => logger.warning('Ask QAgent: open failed', error));
  }
  try {
    await deliverContextPrefill(payload);
  } catch (error) {
    logger.error('Ask QAgent: could not store the prefill', error);
  }
}

/** Registers the "Perguntar ao QAgent" menu. Call once at service worker start-up. */
export function registerContextMenu(): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: ASK_QAGENT_MENU_ID,
        title: t('bg_contextMenu_askTitle'),
        contexts: ['page', 'selection', 'link', 'image'],
      });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleAskClick(info, tab);
  });
}
