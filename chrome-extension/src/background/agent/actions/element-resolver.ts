import { t } from '@extension/i18n';
import type { AgentContext } from '@src/background/agent/types';
import type { BrowserPageLike } from '../../browser/types';
import { hashDomElement } from '../../browser/dom/history/service';
import type { DOMElementNode } from '../../browser/dom/views';
import { parseSelectorIndex } from '../../browser/page-state';

export type ResolvedSelector = { selector: string; node: DOMElementNode | null } | { error: string };

/**
 * Finds `target` (an element from the state the model saw) in a newer scan of the page.
 * An exact match (branch path, attributes and xpath) wins; when content was inserted above the
 * element its xpath shifts, so a single element with the same branch path and attributes is accepted too.
 */
export async function matchElement(
  target: DOMElementNode,
  candidates: Iterable<DOMElementNode>,
): Promise<DOMElementNode | null> {
  const wanted = await hashDomElement(target);
  const loose: DOMElementNode[] = [];
  for (const node of candidates) {
    const hash = await hashDomElement(node);
    if (hash.branchPathHash !== wanted.branchPathHash || hash.attributesHash !== wanted.attributesHash) continue;
    if (hash.xpathHash === wanted.xpathHash) return node;
    loose.push(node);
  }
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Maps an index selector the model wrote (`@e12`, `[12]`) to the same element in the page as it is now.
 * Indexes are document-order counters rebuilt on every scan, so after a banner or toast appears `[12]`
 * can point at another element. The index is looked up in the state the model saw (context.actionState)
 * and that element is found again in the latest scan, which the navigator usually just made; only when
 * no newer scan exists is the page read again. Other selectors pass through unchanged.
 */
export async function resolveActionSelector(
  context: AgentContext,
  page: BrowserPageLike,
  selector: string,
): Promise<ResolvedSelector> {
  const index = parseSelectorIndex(selector);
  if (index === null) return { selector, node: null };

  const modelMap = context.actionState?.selectorMap;
  const modelNode = modelMap?.get(index);
  const cached = page.getCachedState();
  const current = cached && modelMap && cached.selectorMap !== modelMap ? cached : await page.getState();
  if (!modelNode) {
    return { selector, node: current.selectorMap.get(index) ?? null };
  }
  if (current.selectorMap.get(index) === modelNode) return { selector, node: modelNode };

  const match = await matchElement(modelNode, current.selectorMap.values());
  if (!match || match.highlightIndex == null) {
    return { error: t('act_errors_elementChanged', [index.toString()]) };
  }
  return { selector: `@e${match.highlightIndex}`, node: match };
}

export type ResolvedIndex = { index: number; node: DOMElementNode } | { error: string };

/** resolveActionSelector for an element index: the index in the current scan, or why it cannot be used. */
export async function resolveActionIndex(
  context: AgentContext,
  page: BrowserPageLike,
  index: number,
): Promise<ResolvedIndex> {
  const resolved = await resolveActionSelector(context, page, `@e${index}`);
  if ('error' in resolved) return resolved;
  if (!resolved.node || resolved.node.highlightIndex == null) {
    return { error: t('act_errors_elementNotExist', [index.toString()]) };
  }
  return { index: resolved.node.highlightIndex, node: resolved.node };
}
