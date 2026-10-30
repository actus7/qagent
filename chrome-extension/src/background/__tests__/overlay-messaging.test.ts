import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hideOverlay, isOverlayReceiverMissingError, showOverlay } from '../overlay/overlayMessaging';
import { runtimeStore } from '../state/runtimeStore';

const MISSING_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

describe('isOverlayReceiverMissingError', () => {
  it('detects the missing receiver error from an Error instance', () => {
    expect(isOverlayReceiverMissingError(new Error(MISSING_RECEIVER))).toBe(true);
  });

  it('detects the missing receiver error from a plain string or message-like object', () => {
    expect(isOverlayReceiverMissingError(MISSING_RECEIVER)).toBe(true);
    expect(isOverlayReceiverMissingError({ message: MISSING_RECEIVER })).toBe(true);
  });

  it('ignores unrelated errors and empty values', () => {
    expect(isOverlayReceiverMissingError(new Error('Tab was closed'))).toBe(false);
    expect(isOverlayReceiverMissingError({ message: 42 })).toBe(false);
    expect(isOverlayReceiverMissingError(undefined)).toBe(false);
  });
});

describe('showOverlay and hideOverlay', () => {
  const sendMessage = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    sendMessage.mockClear();
    runtimeStore.getState().reset();
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
  });

  it('shows the overlay with its driver and records the tab and driver', () => {
    showOverlay(7, 'claude', 'page_click');

    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'qagent:overlay:show', driver: 'claude' });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'qagent:overlay:status', text: 'page_click' });
    expect(runtimeStore.getState()).toMatchObject({ overlayVisible: true, overlayTabId: 7, overlayDriver: 'claude' });
  });

  it('hides the previous tab when the overlay moves to another tab', () => {
    showOverlay(7, 'claude', 'page_click');
    sendMessage.mockClear();

    showOverlay(9, 'codex', 'page_info');

    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'qagent:overlay:hide' });
    expect(sendMessage).toHaveBeenCalledWith(9, { type: 'qagent:overlay:show', driver: 'codex' });
    expect(runtimeStore.getState().overlayTabId).toBe(9);
  });

  it('does not hide the tab again when the overlay stays on it', () => {
    showOverlay(7, 'claude', 'page_click');
    sendMessage.mockClear();

    showOverlay(7, 'claude', 'page_info');

    expect(sendMessage).not.toHaveBeenCalledWith(7, { type: 'qagent:overlay:hide' });
  });

  it('hides the overlay on its tab and clears the state', () => {
    showOverlay(7, 'claude', 'page_click');
    sendMessage.mockClear();

    hideOverlay();

    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'qagent:overlay:hide' });
    expect(runtimeStore.getState()).toMatchObject({
      overlayVisible: false,
      overlayTabId: null,
      overlayDriver: 'qagent',
    });
  });

  it('ignores a missing tab', () => {
    showOverlay(null, 'qagent', 'Working');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(runtimeStore.getState().overlayVisible).toBe(false);
  });
});
