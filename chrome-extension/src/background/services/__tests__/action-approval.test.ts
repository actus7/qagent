import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ActionApprovalManager } from '../action-approval';
import { t } from '@extension/i18n';
import type { SidePanelResponseMessage } from '@extension/shared';
import type { BrowserContextLike } from '../../browser/types';

describe('browser action approval', () => {
  const tab = { id: 7, url: 'https://example.com/form' };
  const browser = { currentTabId: 7 } as BrowserContextLike;
  beforeEach(() => {
    vi.stubGlobal('chrome', { tabs: { get: vi.fn(async () => ({ ...tab })) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds an action until its own request is approved', async () => {
    const messages: SidePanelResponseMessage[] = [];
    const manager = new ActionApprovalManager(message => messages.push(message));
    const pending = manager.authorize(
      'task',
      'click',
      { intent: 'Submit form' },
      'ask',
      browser,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(messages[0]?.type).toBe('approval_required'));
    const message = messages[0];
    if (message.type !== 'approval_required') throw new Error('missing request');
    expect(message.request.url).toBe(tab.url);
    expect(manager.resolve('other-task', message.request.id, true)).toBe(false);
    expect(manager.resolve('task', 'stale-request', true)).toBe(false);
    expect(manager.resolve('task', message.request.id, true)).toBe(true);
    await expect(pending).resolves.toBeUndefined();
    expect(manager.resolve('task', message.request.id, true)).toBe(false);
  });

  it('stops a pending action on cancellation without approval', async () => {
    const messages: SidePanelResponseMessage[] = [];
    const manager = new ActionApprovalManager(message => messages.push(message));
    const controller = new AbortController();
    const pending = manager.authorize('task', 'fill', {}, 'ask', browser, controller.signal);
    const rejection = expect(pending).rejects.toThrow(t('bg_approval_declined'));
    await vi.waitFor(() => expect(messages.length).toBe(1));
    controller.abort();
    await rejection;
    expect(messages.at(-1)?.type).toBe('approval_resolved');
  });

  it('rejects approval when the page has navigated meanwhile', async () => {
    const messages: SidePanelResponseMessage[] = [];
    const manager = new ActionApprovalManager(message => messages.push(message));
    const pending = manager.authorize('task', 'click', {}, 'ask', browser, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow(t('bg_approval_pageChanged'));
    await vi.waitFor(() => expect(messages.length).toBe(1));
    vi.mocked(chrome.tabs.get as (tabId: number) => Promise<chrome.tabs.Tab>).mockResolvedValue({ ...tab, url: 'https://example.com/other' } as chrome.tabs.Tab);
    const message = messages[0];
    if (message.type === 'approval_required') manager.resolve('task', message.request.id, true);
    await rejection;
  });

  it('allows observations and explicitly enabled automatic actions without prompts', async () => {
    const post = vi.fn();
    const manager = new ActionApprovalManager(post);
    await manager.authorize('task', 'get_text', {}, 'ask', browser, new AbortController().signal);
    await manager.authorize('task', 'click', {}, 'auto', browser, new AbortController().signal);
    expect(post).not.toHaveBeenCalled();
  });
});
