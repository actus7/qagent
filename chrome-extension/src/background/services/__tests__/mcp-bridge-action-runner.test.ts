import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The action list and browser context are stubbed so run_action's tab handling is tested on its own.
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  switchTab: vi.fn(),
  setAllowedTabs: vi.fn(),
  removeHighlight: vi.fn(async () => {}),
  cleanup: vi.fn(async () => {}),
  showOverlay: vi.fn(),
  hideOverlay: vi.fn(),
  taskRunning: false,
  cliTaskRunning: false,
  agentBrowser: false,
}));

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../agent/actions/builder', () => ({
  InvalidInputError: class InvalidInputError extends Error {},
  ActionBuilder: class {
    buildDefaultActions() {
      return [{ name: () => 'page_info', call: mocks.call, schema: { description: '', schema: {} } }];
    }
  },
}));
vi.mock('../../browser/scoped-context', () => ({
  default: class ScopedBrowserContext {
    setAllowedTabs = mocks.setAllowedTabs;
    switchTab = mocks.switchTab;
    removeHighlight = mocks.removeHighlight;
    cleanup = mocks.cleanup;
  },
}));
vi.mock('../../state/browserSession', async () => {
  const { default: Scoped } = await import('../../browser/scoped-context');
  return { browserContext: new Scoped({}), isAgentBrowserContext: () => mocks.agentBrowser };
});
vi.mock('../../overlay/overlayMessaging', () => ({ showOverlay: mocks.showOverlay, hideOverlay: mocks.hideOverlay }));
vi.mock('../../state/runtimeStore', () => ({ runtimeStore: { getState: () => ({ currentExecutor: null }) } }));
vi.mock('../../task/taskRunner', () => ({
  isAssistantTaskRunning: () => mocks.taskRunning || mocks.cliTaskRunning,
  isCliAgentTaskRunning: () => mocks.cliTaskRunning,
}));
vi.mock('../../agent/types', () => ({ AgentContext: class {} }));
vi.mock('../../agent/event/manager', () => ({ EventManager: class {} }));
vi.mock('../../agent/messages/service', () => ({ default: class {}, MessageManagerSettings: class {} }));
vi.mock('../../agent/messages/utils', () => ({
  wrapUntrustedContent: (text: string) => `[untrusted]${text}`,
  wrapUntrustedOnce: (text: string) => (text.includes('<nano_untrusted_content>') ? text : `[untrusted]${text}`),
}));
vi.mock('../../utils', () => ({ convertZodToJsonSchema: () => ({}) }));

import { runBridgeAction } from '../mcpBridge/actionRunner';

describe('runBridgeAction', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskRunning = false;
    mocks.cliTaskRunning = false;
    mocks.agentBrowser = false;
    vi.stubGlobal('chrome', { tabs: { query: vi.fn(async () => [{ id: 42, url: 'https://example.com/' }]) } });
  });

  it('runs on the active tab when the caller gives no tabId', async () => {
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'Title: Example' });

    const outcome = await runBridgeAction({ action: 'page_info', input: {} });

    expect(mocks.setAllowedTabs).toHaveBeenCalledWith([42]);
    expect(mocks.switchTab).toHaveBeenCalledWith(42);
    expect(outcome).toMatchObject({ ok: true, extractedContent: '[untrusted]Title: Example' });
  });

  it('returns a page failure as the action error instead of throwing a generic error', async () => {
    mocks.call.mockRejectedValue(new Error('Puppeteer page is not connected'));

    const outcome = await runBridgeAction({ action: 'page_info', input: {} });

    expect(outcome).toMatchObject({ ok: false, error: '[untrusted]Puppeteer page is not connected' });
  });

  it('removes the numbered highlights after each action, as the agent does', async () => {
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'snapshot' });

    await runBridgeAction({ action: 'page_info', input: {} });

    expect(mocks.removeHighlight).toHaveBeenCalledTimes(1);
  });

  it('releases the debugger only after the MCP client goes idle', async () => {
    vi.useFakeTimers();
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {} });
    await vi.advanceTimersByTimeAsync(20_000);
    await runBridgeAction({ action: 'page_info', input: {} });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.cleanup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('shows the overlay on the acted tab in the colour of the client that drives it', async () => {
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {}, client: 'claude-code' });

    expect(mocks.showOverlay).toHaveBeenCalledWith(42, 'claude', 'page_info');
  });

  it('names the action by its intent when the client gives one', async () => {
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({
      action: 'page_info',
      input: { intent: ' Read the cart total ' },
      client: 'codex-mcp-client',
    });

    expect(mocks.showOverlay).toHaveBeenCalledWith(42, 'codex', 'Read the cart total');
  });

  it('uses the neutral driver for a client it does not recognise', async () => {
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {} });

    expect(mocks.showOverlay).toHaveBeenCalledWith(42, 'external', 'page_info');
  });

  it('keeps the overlay up across consecutive actions and hides it only after the client goes idle', async () => {
    vi.useFakeTimers();
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {}, client: 'claude-code' });
    await vi.advanceTimersByTimeAsync(20_000);
    await runBridgeAction({ action: 'page_info', input: {}, client: 'claude-code' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.hideOverlay).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.hideOverlay).toHaveBeenCalledTimes(1);
    expect(mocks.showOverlay).toHaveBeenCalledTimes(2);
  });

  it('moves the overlay to the tab of an action that targets another tab', async () => {
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {}, client: 'claude-code' });
    await runBridgeAction({ action: 'page_info', input: {}, tabId: 9, client: 'claude-code' });

    expect(mocks.showOverlay).toHaveBeenLastCalledWith(9, 'claude', 'page_info');
  });

  it('does not show the overlay while an executor task owns the browser', async () => {
    mocks.taskRunning = true;

    await expect(runBridgeAction({ action: 'page_info', input: {} })).rejects.toMatchObject({ code: 'TASK_BUSY' });

    expect(mocks.showOverlay).not.toHaveBeenCalled();
  });

  it('lets the CLI agent of a running CLI task drive the page', async () => {
    mocks.cliTaskRunning = true;
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    const outcome = await runBridgeAction({ action: 'page_info', input: {}, client: 'claude-code' });

    expect(outcome).toMatchObject({ ok: true });
  });

  it('does not show the overlay in the agent browser context', async () => {
    mocks.agentBrowser = true;
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {} });

    expect(mocks.showOverlay).not.toHaveBeenCalled();
  });

  it('moves to the most recent web page when the active tab is a Chrome page', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn(async (info: { active?: boolean }) =>
          info.active
            ? [{ id: 1, url: 'chrome://newtab/' }]
            : [
                { id: 1, url: 'chrome://newtab/', lastAccessed: 9 },
                { id: 5, url: 'https://a.test/', lastAccessed: 3 },
                { id: 6, url: 'https://b.test/', lastAccessed: 7 },
              ],
        ),
      },
    });
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {} });

    expect(mocks.switchTab).toHaveBeenCalledWith(6);
  });

  it('falls back to a web page of any window when the focused window has none', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn(async (info: { active?: boolean; lastFocusedWindow?: boolean }) =>
          info.active || info.lastFocusedWindow
            ? [{ id: 1, url: 'chrome-extension://abc/page.html' }]
            : [{ id: 8, url: 'https://c.test/', lastAccessed: 1 }],
        ),
      },
    });
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: 'ok' });

    await runBridgeAction({ action: 'page_info', input: {} });

    expect(mocks.switchTab).toHaveBeenCalledWith(8);
  });

  it('fails with no tab when no web page is open at all', async () => {
    vi.stubGlobal('chrome', { tabs: { query: vi.fn(async () => [{ id: 1, url: 'chrome://settings/' }]) } });

    await expect(runBridgeAction({ action: 'page_info', input: {} })).rejects.toMatchObject({
      code: 'TAB_UNAVAILABLE',
    });
    expect(mocks.switchTab).not.toHaveBeenCalled();
  });

  it('passes content that an action already wrapped through without wrapping it again', async () => {
    const wrapped = '<nano_untrusted_content>\nTitle: Example\n</nano_untrusted_content>';
    mocks.call.mockResolvedValue({ error: null, isDone: false, extractedContent: wrapped });

    const outcome = await runBridgeAction({ action: 'page_info', input: {} });

    expect(outcome.extractedContent).toBe(wrapped);
  });

  it('does not release the debugger while an action is still running', async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => {};
    mocks.call.mockImplementation(() => new Promise(resolve => (finish = resolve)));

    const running = runBridgeAction({ action: 'page_info', input: {} });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(mocks.cleanup).not.toHaveBeenCalled();

    finish({ error: null, isDone: false, extractedContent: 'ok' });
    await running;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
});
