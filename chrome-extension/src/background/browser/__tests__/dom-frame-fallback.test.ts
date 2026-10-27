import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('webextension-polyfill', () => ({}));
import { getClickableElements } from '../dom/service';

const MAIN_FRAME_ID = 0;
const BLOCKED_FRAME_ID = 5;

/** The top document: its one iframe failed to load, so the DOM read has to reach into that frame. */
function mainPageResult() {
  return {
    rootId: '0',
    map: {
      '0': { tagName: 'body', xpath: '/body', attributes: {}, children: ['1'], isVisible: true },
      '1': {
        tagName: 'iframe',
        xpath: '/body/iframe',
        attributes: { error: 'Blocked by policy', computedHeight: '100', computedWidth: '200' },
        children: [],
        isVisible: true,
      },
    },
  };
}

describe('DOM read when a sub-frame cannot be inspected', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: vi.fn(async ({ target, args, files }: { target: { frameIds?: number[] }; args?: unknown[]; files?: string[] }) => {
          if (files) return [];
          const frameIds = target.frameIds ?? [MAIN_FRAME_ID];
          // Builder probe: no arguments
          if (!args) return frameIds.map(frameId => ({ frameId, result: true }));
          // The main document's DOM build: its first argument is the options object
          if (typeof args[0] === 'object') return [{ frameId: MAIN_FRAME_ID, result: mainPageResult() }];
          // Frame info probe for a sub-frame that the browser refuses to script
          throw new Error('Cannot access contents of the page');
        }),
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ frameId: MAIN_FRAME_ID }, { frameId: BLOCKED_FRAME_ID }]),
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the top document tree instead of failing the whole read', async () => {
    const state = await getClickableElements(1, 'https://example.com/page');

    expect(state.elementTree.tagName).toBe('body');
    expect(state.selectorMap.size).toBe(0);
  });
});
