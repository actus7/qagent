import { createLogger } from '../log';

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
    const url = tab.url?.trim().toLowerCase() ?? '';

    // Keep this aligned with Page valid web page constraints.
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return false;
    }

    if (url.startsWith('https://chromewebstore.google.com')) {
      return false;
    }

    return true;
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
