import { DOMElementNode } from './dom/views';
import type { PageState } from './views';

const REF_SELECTOR_REGEX = /^@e(\d+)$/i;
const LEGACY_INDEX_SELECTOR_REGEX = /^\[(\d+)\]$/;

export function build_initial_state(tabId?: number, url?: string, title?: string): PageState {
  return {
    elementTree: new DOMElementNode({
      tagName: 'root',
      isVisible: true,
      parent: null,
      xpath: '',
      attributes: {},
      children: [],
    }),
    selectorMap: new Map(),
    tabId: tabId || 0,
    url: url || '',
    title: title || '',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

/**
 * Cached clickable elements hashes for the last state
 */
export class CachedStateClickableElementsHashes {
  url: string;
  hashes: Set<string>;

  constructor(url: string, hashes: Set<string>) {
    this.url = url;
    this.hashes = hashes;
  }
}

/**
 * Extracts the element index from a selector of the form `@e12` or `[12]`.
 * Returns null when the selector is not in one of those formats.
 */
export function parseSelectorIndex(selector: string): number | null {
  const trimmedSelector = selector.trim();
  const refMatch = REF_SELECTOR_REGEX.exec(trimmedSelector);
  if (refMatch) {
    return Number.parseInt(refMatch[1], 10);
  }

  const legacyIndexMatch = LEGACY_INDEX_SELECTOR_REGEX.exec(trimmedSelector);
  if (legacyIndexMatch) {
    return Number.parseInt(legacyIndexMatch[1], 10);
  }

  return null;
}
