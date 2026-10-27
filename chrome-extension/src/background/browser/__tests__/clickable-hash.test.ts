import { describe, expect, it } from 'vitest';
import { DOMElementNode } from '../dom/views';
import { hashDomElement, markNewClickableElements } from '../dom/clickable/service';
import type { CachedStateClickableElementsHashes } from '../page-state';

function element(params: {
  tagName: string;
  xpath: string;
  attributes?: Record<string, string>;
  highlightIndex?: number | null;
  parent?: DOMElementNode | null;
}): DOMElementNode {
  return new DOMElementNode({
    tagName: params.tagName,
    xpath: params.xpath,
    attributes: params.attributes ?? {},
    children: [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: params.highlightIndex ?? null,
    parent: params.parent ?? null,
  });
}

function buildTree(): { root: DOMElementNode; link: DOMElementNode; button: DOMElementNode } {
  const root = element({ tagName: 'body', xpath: '/body' });
  const link = element({ tagName: 'a', xpath: '/body/a', attributes: { href: '/next' }, highlightIndex: 0, parent: root });
  const wrapper = element({ tagName: 'div', xpath: '/body/div', parent: root });
  const button = element({ tagName: 'button', xpath: '/body/div/button', highlightIndex: 1, parent: wrapper });
  root.children.push(link, wrapper);
  wrapper.children.push(button);
  return { root, link, button };
}

describe('clickable element hashes', () => {
  it('hashes an element synchronously and tells two different elements apart', () => {
    const { link, button } = buildTree();
    expect(typeof hashDomElement(link)).toBe('string');
    expect(hashDomElement(link)).toBe(hashDomElement(link));
    expect(hashDomElement(link)).not.toBe(hashDomElement(button));
  });

  it('marks nothing as new on the first read of a page', () => {
    const { root } = buildTree();
    const hashes = markNewClickableElements(root, 'https://example.com/a', null);
    expect(hashes.size).toBe(2);
  });

  it('marks only the elements that were not clickable on the previous read of the same URL', () => {
    const { root, link, button } = buildTree();
    const previous: Pick<CachedStateClickableElementsHashes, 'url' | 'hashes'> = {
      url: 'https://example.com/a',
      hashes: new Set([hashDomElement(link)]),
    };

    markNewClickableElements(root, 'https://example.com/a', previous);

    expect(link.isNew).toBe(false);
    expect(button.isNew).toBe(true);
  });

  it('does not compare against a previous read of a different URL', () => {
    const { root, link, button } = buildTree();
    const previous = { url: 'https://example.com/other', hashes: new Set([hashDomElement(link)]) };

    markNewClickableElements(root, 'https://example.com/a', previous);

    expect(link.isNew).not.toBe(true);
    expect(button.isNew).not.toBe(true);
  });
});
