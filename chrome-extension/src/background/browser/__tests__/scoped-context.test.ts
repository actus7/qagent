import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('webextension-polyfill', () => ({}));
import BrowserContext from '../context';
import ScopedBrowserContext from '../scoped-context';
import type { BrowserPageLike } from '../types';

describe('native task tab scope', () => {
  const tabs = [
    { id: 1, url: 'https://one.example.com', title: 'Selected' },
    { id: 2, url: 'https://private.example.com', title: 'Not selected' },
    { id: 3, url: 'https://blocked.example.com', title: 'Blocked' },
  ];
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(async () => tabs), get: vi.fn(async (id: number) => tabs.find(tab => tab.id === id)) },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reveals only the selected tabs', async () => {
    const context = new ScopedBrowserContext({});
    context.setAllowedTabs([1, 3]);
    expect((await context.getTabInfos()).map(tab => tab.id)).toEqual([1, 3]);
    expect([...(await context.getAllTabIds())]).toEqual([1, 3]);
  });

  it('blocks switching to or closing an unselected tab before any browser action', async () => {
    const switchTab = vi.spyOn(BrowserContext.prototype, 'switchTab');
    const closeTab = vi.spyOn(BrowserContext.prototype, 'closeTab');
    const context = new ScopedBrowserContext({});
    context.setAllowedTabs([1]);
    await expect(context.switchTab(2)).rejects.toThrow('incluída');
    await expect(context.closeTab(2)).rejects.toThrow('incluída');
    expect(switchTab).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it('adds a newly created tab to the task scope', async () => {
    vi.spyOn(BrowserContext.prototype, 'openTab').mockResolvedValue({ tabId: 2 } as BrowserPageLike);
    const context = new ScopedBrowserContext({});
    context.setAllowedTabs([1]);
    await context.openTab(tabs[1].url);
    expect([...(await context.getAllTabIds())]).toEqual([1, 2]);
  });

  it('does not attach a debugger or open a replacement tab during cleanup', async () => {
    const getPage = vi.spyOn(BrowserContext.prototype, 'getCurrentPage');
    const context = new ScopedBrowserContext({});
    await context.cleanup();
    expect(getPage).not.toHaveBeenCalled();
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });
});
