import { t } from '@extension/i18n';

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** Captures the visible area of a tab as a PNG data URL. Only the active tab of a window is visible. */
export async function captureVisibleTab(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:\/\//i.test(tab.url) || tab.windowId === undefined) {
    throw new Error(t('bg_cmd_capture_unsupported'));
  }
  if (!tab.active) {
    throw new Error(t('bg_cmd_capture_notActive'));
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error(t('bg_cmd_capture_failed'));
  }
  return dataUrl;
}
