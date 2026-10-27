import { describe, expect, it, vi } from 'vitest';
import { DOMElementNode } from '../../../browser/dom/views';
import { matchElement, resolveActionSelector } from '../element-resolver';
import type { AgentContext } from '../../types';
import type { BrowserPageLike } from '../../../browser/types';

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

function node(tag: string, xpath: string, attributes: Record<string, string>, index: number): DOMElementNode {
  const body = new DOMElementNode({
    tagName: 'body',
    xpath: 'html/body',
    attributes: {},
    children: [],
    isVisible: true,
  });
  return new DOMElementNode({
    tagName: tag,
    xpath,
    attributes,
    children: [],
    isVisible: true,
    highlightIndex: index,
    parent: body,
  });
}

const mapOf = (...nodes: DOMElementNode[]) => new Map(nodes.map(n => [n.highlightIndex as number, n]));

describe('matchElement', () => {
  it('finds the element again when content inserted above shifted its xpath and index', async () => {
    const seen = node('button', 'html/body/button[1]', { id: 'save' }, 3);
    const banner = node('a', 'html/body/a[1]', { href: '/promo' }, 3);
    const moved = node('button', 'html/body/button[2]', { id: 'save' }, 4);
    expect(await matchElement(seen, [banner, moved])).toBe(moved);
  });

  it('returns null when two candidates look the same and the xpath does not decide', async () => {
    const seen = node('button', 'html/body/button[1]', { class: 'row' }, 1);
    const a = node('button', 'html/body/button[2]', { class: 'row' }, 2);
    const b = node('button', 'html/body/button[3]', { class: 'row' }, 3);
    expect(await matchElement(seen, [a, b])).toBeNull();
  });
});

describe('resolveActionSelector', () => {
  const pageWith = (current: Map<number, DOMElementNode>) =>
    ({
      getCachedState: () => ({ selectorMap: current }),
      getState: vi.fn(async () => ({ selectorMap: current })),
    }) as unknown as BrowserPageLike;

  it('rewrites the index the model saw to the index of the same element now', async () => {
    const seen = node('button', 'html/body/button[1]', { id: 'save' }, 3);
    const moved = node('button', 'html/body/button[2]', { id: 'save' }, 4);
    const banner = node('a', 'html/body/a[1]', { href: '/promo' }, 3);
    const context = { actionState: { selectorMap: mapOf(seen) } } as unknown as AgentContext;

    const resolved = await resolveActionSelector(context, pageWith(mapOf(banner, moved)), '@e3');

    expect(resolved).toEqual({ selector: '@e4', node: moved });
  });

  it('fails instead of acting on another element when the element is gone', async () => {
    const seen = node('button', 'html/body/button[1]', { id: 'save' }, 3);
    const other = node('a', 'html/body/a[1]', { href: '/promo' }, 3);
    const context = { actionState: { selectorMap: mapOf(seen) } } as unknown as AgentContext;

    const resolved = await resolveActionSelector(context, pageWith(mapOf(other)), '@e3');

    expect(resolved).toEqual({ error: 'act_errors_elementChanged' });
  });

  it('passes CSS selectors through unchanged', async () => {
    const context = { actionState: null } as unknown as AgentContext;
    expect(await resolveActionSelector(context, pageWith(new Map()), '#login')).toEqual({
      selector: '#login',
      node: null,
    });
  });
});
