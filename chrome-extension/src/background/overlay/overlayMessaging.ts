import { createLogger } from '../log';
import { runtimeStore } from '../state/runtimeStore';
import type { OverlayDriver } from './overlayDriver';
import { isAutomatableWebUrl } from '../browser/web-page';

const logger = createLogger('background');
const OVERLAY_RECEIVER_MISSING_ERROR = 'Could not establish connection. Receiving end does not exist.';
const overlayInjectionInFlight = new Set<number>();

export function isOverlayReceiverMissingError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === 'string') {
    return error.includes(OVERLAY_RECEIVER_MISSING_ERROR);
  }

  if (error instanceof Error) {
    return error.message.includes(OVERLAY_RECEIVER_MISSING_ERROR);
  }

  const maybeMessage = (error as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.includes(OVERLAY_RECEIVER_MISSING_ERROR);
}

async function canInjectOverlayIntoTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return isAutomatableWebUrl(tab.url);
  } catch {
    return false;
  }
}

async function injectOverlayReceiver(tabId: number): Promise<boolean> {
  if (overlayInjectionInFlight.has(tabId)) {
    return false;
  }

  if (!(await canInjectOverlayIntoTab(tabId))) {
    return false;
  }

  overlayInjectionInFlight.add(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.iife.js'],
    });
    return true;
  } catch (error) {
    logger.debug('sendOverlayMessage: Overlay reinjection skipped', error);
    return false;
  } finally {
    overlayInjectionInFlight.delete(tabId);
  }
}

// Longest the action waits for the cursor to reach its target. The glide itself takes 300-450 ms.
const AGENT_POINTER_WAIT_MS = 500;

/**
 * Glides the agent cursor to a viewport point (CSS px) before an action. Resolves once the content script
 * reports arrival or after AGENT_POINTER_WAIT_MS; missing content scripts never reject or block the action.
 */
export function showAgentPointer(tabId: number | null | undefined, x: number, y: number): Promise<void> {
  if (!tabId || !Number.isFinite(x) || !Number.isFinite(y)) return Promise.resolve();

  let arrived: Promise<unknown>;
  try {
    arrived = chrome.tabs.sendMessage(tabId, { type: 'qagent:overlay:pointer', x, y }).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, AGENT_POINTER_WAIT_MS);
    void arrived.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export type OverlayMode = 'running' | 'paused' | 'approval';

/** Records the mode and tells the content overlay, which restyles the glow border (paused freezes it). */
export function applyOverlayMode(tabId: number | null, mode: OverlayMode): void {
  runtimeStore.getState().setOverlayMode(mode);
  sendOverlayMessage(tabId, { type: 'qagent:overlay:mode', mode });
}

/**
 * Shows the overlay on a tab in its driver's colour and records it. The overlay follows the tab being acted on,
 * so the tab it leaves gets a hide.
 */
export function showOverlay(tabId: number | null, driver: OverlayDriver, statusText: string): void {
  if (!tabId) return;
  const store = runtimeStore.getState();
  const previousTabId = store.overlayTabId;
  if (previousTabId !== null && previousTabId !== tabId) {
    sendOverlayMessage(previousTabId, { type: 'qagent:overlay:hide' });
  }
  store.setOverlayTabId(tabId);
  store.setOverlayDriver(driver);
  store.setOverlayStatusText(statusText);
  store.setOverlayVisible(true);
  sendOverlayMessage(tabId, { type: 'qagent:overlay:show', driver });
  sendOverlayMessage(tabId, { type: 'qagent:overlay:status', text: statusText });
}

/** Hides the overlay on the tab it sits on and clears the recorded state. */
export function hideOverlay(): void {
  const { overlayTabId, resetOverlay } = runtimeStore.getState();
  resetOverlay();
  if (overlayTabId !== null) sendOverlayMessage(overlayTabId, { type: 'qagent:overlay:hide' });
}

// Send a message to the active tab's content script for overlay updates
export function sendOverlayMessage(tabId: number | null, message: Record<string, unknown>) {
  if (!tabId) {
    logger.warning('sendOverlayMessage: No tabId');
    return;
  }

  chrome.tabs.sendMessage(tabId, message).catch(async error => {
    if (!isOverlayReceiverMissingError(error)) {
      logger.warning('sendOverlayMessage: Failed to send', error);
      return;
    }

    // Expected in tabs without content script. Attempt a one-shot reinjection for valid web pages.
    const injected = await injectOverlayReceiver(tabId);
    if (!injected) {
      return;
    }

    chrome.tabs.sendMessage(tabId, message).catch(retryError => {
      if (!isOverlayReceiverMissingError(retryError)) {
        logger.warning('sendOverlayMessage: Failed to send after reinjection', retryError);
      }
    });
  });
}
