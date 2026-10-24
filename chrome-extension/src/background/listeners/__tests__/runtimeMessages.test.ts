import { beforeEach, describe, expect, it, vi } from 'vitest';

const testProviderConnection = vi.fn();

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));
// @extension/shared pulls in the storage package, which needs chrome.storage at import time.
vi.mock('@extension/storage', () => new Proxy({}, { get: () => ({}) }));
vi.mock('../../log', () => ({ createLogger: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock('../../state/browserSession', () => ({ browserContext: {} }));
vi.mock('../../state/runtimeStore', () => ({ runtimeStore: { getState: () => ({}) } }));
vi.mock('../../task/taskRunner', () => ({ cancelActiveTask: vi.fn() }));
vi.mock('../../services/provider-test', () => ({ testProviderConnection }));
vi.mock('../../services/scheduling/runner', () => ({ runScheduledTask: vi.fn() }));
vi.mock('../../services/step-screenshots', () => ({ readStepScreenshots: vi.fn() }));

const EXTENSION_ORIGIN = 'chrome-extension://abc/';
type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | undefined;

async function registerListener(): Promise<Listener> {
  let listener: Listener | undefined;
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'abc',
      getURL: () => EXTENSION_ORIGIN,
      onMessage: { addListener: (fn: Listener) => (listener = fn) },
    },
  });
  const { registerRuntimeMessageListener } = await import('../runtimeMessages');
  registerRuntimeMessageListener();
  return listener as Listener;
}

describe('qagent:test-provider', () => {
  beforeEach(() => {
    testProviderConnection.mockReset().mockResolvedValue({ ok: true });
  });

  it('answers the options page even when it is open in a tab', async () => {
    const listener = await registerListener();
    const sendResponse = vi.fn();
    const sender = { id: 'abc', url: `${EXTENSION_ORIGIN}options/index.html`, tab: { id: 7 } };

    const keepOpen = listener({ type: 'qagent:test-provider', providerId: 'p1' }, sender, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));

    expect(keepOpen).toBe(true);
    expect(testProviderConnection).toHaveBeenCalledWith('p1');
  });

  it('ignores a content script running in a web page', async () => {
    const listener = await registerListener();
    const sendResponse = vi.fn();
    const sender = { id: 'abc', url: 'https://evil.example/page', tab: { id: 7 } };

    const keepOpen = listener({ type: 'qagent:test-provider', providerId: 'p1' }, sender, sendResponse);

    expect(keepOpen).toBe(false);
    expect(testProviderConnection).not.toHaveBeenCalled();
  });
});
