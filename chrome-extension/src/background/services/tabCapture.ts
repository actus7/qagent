import { firewallStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { isUrlAllowed } from '../browser/util';
import { isManagedUrlAllowed } from '../state/managedPolicyState';

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
  const firewall = await firewallStore.getFirewall();
  if ((firewall.enabled && !isUrlAllowed(tab.url, firewall.allowList, firewall.denyList)) || !isManagedUrlAllowed(tab.url)) {
    throw new Error(t('bg_cmd_capture_blocked'));
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error(t('bg_cmd_capture_failed'));
  }
  return dataUrl;
}
