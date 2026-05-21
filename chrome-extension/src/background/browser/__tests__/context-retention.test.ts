import { describe, expect, it, vi } from 'vitest';
vi.mock('webextension-polyfill', () => ({}));
import BrowserContext from '../context';
import Page, { CachedStateClickableElementsHashes, build_initial_state } from '../page';

function createPageDouble(tabId: number) {
  const attachPuppeteer = vi.fn().mockResolvedValue(true);
  const detachPuppeteer = vi.fn().mockResolvedValue(undefined);
  const page = {
    tabId,
    attachPuppeteer,
    detachPuppeteer,
  } as unknown as Page;

  return { page, attachPuppeteer, detachPuppeteer };
}

describe('BrowserContext attached page retention', () => {
  it('keeps only the three most recently used attached pages', async () => {
    const context = new BrowserContext({});
    const p1 = createPageDouble(1);
    const p2 = createPageDouble(2);
    const p3 = createPageDouble(3);
    const p4 = createPageDouble(4);

    await context.attachPage(p1.page);
    await context.attachPage(p2.page);
    await context.attachPage(p3.page);
    await context.attachPage(p1.page);
    await context.attachPage(p4.page);

    expect(p2.detachPuppeteer).toHaveBeenCalledTimes(1);
    expect(p1.detachPuppeteer).not.toHaveBeenCalled();
    expect(p3.detachPuppeteer).not.toHaveBeenCalled();
    expect(p4.detachPuppeteer).not.toHaveBeenCalled();

    const attachedPages = (context as unknown as { _attachedPages: Map<number, Page> })._attachedPages;
    expect(attachedPages.size).toBe(3);
    expect([...attachedPages.keys()]).toEqual([3, 1, 4]);
  });
});

describe('Page detach cleanup', () => {
  it('clears cached state and screenshot payloads on detach', async () => {
    const page = new Page(9, 'https://example.com', 'Example');
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const cachedState = build_initial_state(9, 'https://example.com', 'Example');
    cachedState.screenshot = 'large-image-payload';

    const internalPage = page as unknown as {
      _browser: { disconnect: () => Promise<void> } | null;
      _puppeteerPage: object | null;
      _state: ReturnType<typeof build_initial_state>;
      _cachedState: ReturnType<typeof build_initial_state> | null;
      _cachedStateClickableElementsHashes: CachedStateClickableElementsHashes | null;
    };

    internalPage._browser = { disconnect };
    internalPage._puppeteerPage = {};
    internalPage._state.screenshot = 'large-image-payload';
    internalPage._cachedState = cachedState;
    internalPage._cachedStateClickableElementsHashes = new CachedStateClickableElementsHashes(
      'https://example.com',
      new Set(['abc']),
    );

    await page.detachPuppeteer();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(internalPage._browser).toBeNull();
    expect(internalPage._puppeteerPage).toBeNull();
    expect(internalPage._cachedState).toBeNull();
    expect(internalPage._cachedStateClickableElementsHashes).toBeNull();
    expect(internalPage._state.screenshot).toBeNull();
  });
});
