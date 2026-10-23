import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionApprovalManager, navigationTargetUrl } from '../action-approval';
import type { SidePanelResponseMessage } from '@extension/shared';
import type { BrowserContextLike } from '../../browser/types';

const pageUrl = { current: 'https://shop.example.com/cart' };

function makeManager(allowed: string[] = []) {
  const messages: SidePanelResponseMessage[] = [];
  const added: string[] = [];
  const manager = new ActionApprovalManager(message => messages.push(message), {
    sitePermissions: {
      getAllowedOrigins: vi.fn(async () => allowed),
      addOrigin: vi.fn(async (input: string) => {
        added.push(input);
        return input;
      }),
    },
  });
  return { manager, messages, added };
}

const browser = { currentTabId: 3, getCurrentPage: vi.fn(async () => ({ getCachedState: () => null })) };

function requestOf(messages: SidePanelResponseMessage[]) {
  const message = messages.at(-1);
  if (message?.type !== 'approval_required') throw new Error('no approval request');
  return message.request;
}

describe('approval policy', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', { tabs: { get: vi.fn(async () => ({ id: 3, url: pageUrl.current })) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('always asks for sensitive actions, even in auto mode, and offers no always-allow choice', async () => {
    const { manager, messages } = makeManager();
    const pending = manager.authorize(
      'task',
      'execute_javascript',
      { intent: 'run check' },
      'auto',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(messages.length).toBe(1));
    const request = requestOf(messages);
    expect(request.sensitive).toBe(true);
    expect(request.allowSiteOption).toBe(false);
    manager.cancel();
    await expect(pending).rejects.toThrow();
  });

  it('skips the prompt for non-sensitive actions on an always-allowed origin in ask mode', async () => {
    const { manager, messages } = makeManager(['https://shop.example.com']);
    await manager.authorize(
      'task',
      'click_element',
      { intent: 'Open filters', index: 1 },
      'ask',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    expect(messages).toHaveLength(0);
  });

  it('persists the origin when the user chooses always-allow for this site', async () => {
    const { manager, messages, added } = makeManager();
    const pending = manager.authorize(
      'task',
      'click_element',
      { intent: 'Open filters', index: 1 },
      'ask',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(messages.length).toBe(1));
    const request = requestOf(messages);
    expect(request.allowSiteOption).toBe(true);
    expect(manager.resolve('task', request.id, true, 'always_site')).toBe(true);
    await expect(pending).resolves.toBeUndefined();
    expect(added).toEqual(['https://shop.example.com/cart']);
  });

  it('does not persist the origin on a one-time approval', async () => {
    const { manager, messages, added } = makeManager();
    const pending = manager.authorize(
      'task',
      'click_element',
      { intent: 'Open filters', index: 1 },
      'ask',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(messages.length).toBe(1));
    manager.resolve('task', requestOf(messages).id, true, 'once');
    await expect(pending).resolves.toBeUndefined();
    expect(added).toEqual([]);
  });

  it('asks with the transition when a navigation leaves the current site', async () => {
    const { manager, messages } = makeManager(['https://shop.example.com']);
    const pending = manager.authorize(
      'task',
      'go_to_url',
      { intent: 'Go to payment provider', url: 'https://pay.provider.net/x' },
      'ask',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(messages.length).toBe(1));
    const request = requestOf(messages);
    expect(request.transition).toEqual({ from: 'example.com', to: 'provider.net' });
    expect(request.targetUrl).toBe('https://pay.provider.net/x');
    manager.cancel();
    await expect(pending).rejects.toThrow();
  });

  it('asks for plan approval first in plan mode, then runs planned actions without prompts', async () => {
    const { manager, messages } = makeManager();
    manager.startTask('task', 'Check the prices on https://shop.example.com and compare');
    const pending = manager.authorize(
      'task',
      'click_element',
      { intent: 'Open product', index: 2 },
      'plan',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(messages.length).toBe(1));
    const planRequest = requestOf(messages);
    expect(planRequest.kind).toBe('plan');
    expect(planRequest.domains).toEqual(['example.com']);
    manager.resolve('task', planRequest.id, true, 'once');
    // The planned domain runs without a per-action prompt, so only the plan request was ever shown.
    await expect(pending).resolves.toBeUndefined();

    await manager.authorize(
      'task',
      'click_element',
      { intent: 'Next', index: 4 },
      'plan',
      browser as unknown as BrowserContextLike,
      new AbortController().signal,
    );
    expect(messages.filter(m => m.type === 'approval_required')).toHaveLength(1);
  });
});

describe('navigation target', () => {
  it('reads the destination from navigation inputs only', () => {
    expect(navigationTargetUrl('go_to_url', { url: 'https://a.com' })).toBe('https://a.com');
    expect(navigationTargetUrl('open_tab', { url: 'https://b.com' })).toBe('https://b.com');
    expect(navigationTargetUrl('search_google', { query: 'a b' })).toBe('https://www.google.com/search?q=a%20b');
    expect(navigationTargetUrl('click_element', { url: 'https://c.com' })).toBeNull();
  });
});
