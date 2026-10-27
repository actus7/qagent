import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type UpdatedListener = (tabId: number, changeInfo: { status?: string }, tab: { url?: string }) => Promise<void>;

const mocks = vi.hoisted(() => ({
  sendOverlayMessage: vi.fn(),
  runtime: {
    currentExecutor: { id: 'executor' },
    overlayVisible: true,
    overlayStatusText: 'status',
    overlayMode: 'full',
  },
  browser: { currentTabId: 7, detachPage: vi.fn(async () => undefined), removeAttachedPage: vi.fn() },
}));

vi.mock('../log', () => ({ createLogger: () => ({ info: vi.fn(), warning: vi.fn() }) }));
vi.mock('../overlay/overlayMessaging', () => ({ sendOverlayMessage: mocks.sendOverlayMessage }));
vi.mock('../state/browserSession', () => ({
  browserContext: mocks.browser,
  isAgentBrowserContext: () => false,
}));
vi.mock('../state/runtimeStore', () => ({
  runtimeStore: { getState: () => mocks.runtime },
}));

import { registerTabListeners } from '../listeners/tabs';

let onUpdated: UpdatedListener;
let onRemoved: (tabId: number) => void;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.sendOverlayMessage.mockClear();
  const chromeStub = {
    tabs: {
      onUpdated: { addListener: (listener: UpdatedListener) => (onUpdated = listener) },
      onRemoved: { addListener: (listener: (tabId: number) => void) => (onRemoved = listener) },
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  registerTabListeners();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const completeUpdate = (tabId: number) => onUpdated(tabId, { status: 'complete' }, { url: 'https://example.com' });

describe('overlay re-injection on tab updates', () => {
  it('re-injects the overlay 500 ms after a complete update of the controlled tab', async () => {
    await completeUpdate(7);
    expect(mocks.sendOverlayMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(mocks.sendOverlayMessage).toHaveBeenCalledWith(7, { type: 'qagent:overlay:show' });
  });

  it('cancels the pending re-injection when a newer update arrives for the same tab', async () => {
    await completeUpdate(7);
    await onUpdated(7, { status: 'loading' }, { url: 'https://example.com/next' });
    vi.advanceTimersByTime(1000);
    expect(mocks.sendOverlayMessage).not.toHaveBeenCalled();
  });

  it('cancels the pending re-injection when the tab is removed', async () => {
    await completeUpdate(7);
    onRemoved(7);
    vi.advanceTimersByTime(1000);
    expect(mocks.sendOverlayMessage).not.toHaveBeenCalled();
  });

  it('keeps the pending re-injection of other tabs', async () => {
    mocks.browser.currentTabId = 7;
    await completeUpdate(7);
    await onUpdated(8, { status: 'loading' }, { url: 'https://other.example' });
    vi.advanceTimersByTime(500);
    expect(mocks.sendOverlayMessage).toHaveBeenCalledWith(7, { type: 'qagent:overlay:show' });
  });
});
