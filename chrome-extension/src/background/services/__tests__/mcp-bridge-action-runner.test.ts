import { beforeEach, describe, expect, it, vi } from 'vitest';

// The action list and browser context are stubbed so run_action's tab handling is tested on its own.
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  switchTab: vi.fn(),
  setAllowedTabs: vi.fn(),
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
  },
}));
vi.mock('../../state/browserSession', async () => {
  const { default: Scoped } = await import('../../browser/scoped-context');
  return { browserContext: new Scoped({}) };
});
vi.mock('../../state/runtimeStore', () => ({ runtimeStore: { getState: () => ({ currentExecutor: null }) } }));
vi.mock('../../task/taskRunner', () => ({ isAssistantTaskRunning: () => false }));
vi.mock('../../agent/types', () => ({ AgentContext: class {} }));
vi.mock('../../agent/event/manager', () => ({ EventManager: class {} }));
vi.mock('../../agent/messages/service', () => ({ default: class {}, MessageManagerSettings: class {} }));
vi.mock('../../agent/messages/utils', () => ({ wrapUntrustedContent: (text: string) => `[untrusted]${text}` }));
vi.mock('../../utils', () => ({ convertZodToJsonSchema: () => ({}) }));

import { runBridgeAction } from '../mcpBridge/actionRunner';

describe('runBridgeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { tabs: { query: vi.fn(async () => [{ id: 42 }]) } });
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
});
