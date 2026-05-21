import { DOMElementNode, DOMTextNode } from '../dom/views';
import type { PageState } from '../views';
import type { RefMap } from './protocol';

const REF_LINE_REGEX = /\[ref=e(\d+)\]/i;
const ROLE_LINE_REGEX = /^\s*-?\s*([a-zA-Z0-9_:-]+)/;
const NAME_LINE_REGEX = /"([^"]+)"/;

function roleToTag(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return 'element';
  }

  switch (normalized) {
    case 'textbox':
      return 'input';
    case 'link':
      return 'a';
    case 'img':
      return 'img';
    default:
      return normalized.replace(/[^a-z0-9_-]/g, '_');
  }
}

function parseSnapshotLine(line: string): { index: number; role?: string; name?: string } | null {
  const refMatch = REF_LINE_REGEX.exec(line);
  if (!refMatch) {
    return null;
  }

  const index = Number.parseInt(refMatch[1], 10);
  if (!Number.isFinite(index)) {
    return null;
  }

  const roleMatch = ROLE_LINE_REGEX.exec(line);
  const role = roleMatch?.[1];
  const nameMatch = NAME_LINE_REGEX.exec(line);
  const name = nameMatch?.[1];

  return { index, role, name };
}

function buildNode(params: {
  index: number;
  role: string;
  name: string;
  selector?: string;
  nth?: number;
  parent: DOMElementNode;
}): DOMElementNode {
  const attributes: Record<string, string> = {
    role: params.role,
  };

  if (params.selector) {
    attributes['data-selector'] = params.selector;
  }
  if (typeof params.nth === 'number') {
    attributes['data-nth'] = String(params.nth);
  }

  const node = new DOMElementNode({
    tagName: roleToTag(params.role),
    xpath: null,
    attributes,
    children: [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: params.index,
    parent: params.parent,
  });

  if (params.name.trim()) {
    const textChild = new DOMTextNode(params.name.trim(), true, node);
    node.children.push(textChild);
  }

  return node;
}

export function buildPageStateFromSnapshot(args: {
  tabId: number;
  url: string;
  title: string;
  snapshotTree?: string;
  refs?: RefMap;
  screenshot?: string | null;
  fallbackState?: PageState | null;
}): PageState {
  const root = new DOMElementNode({
    tagName: 'root',
    xpath: '',
    attributes: {},
    children: [],
    isVisible: true,
    isInteractive: false,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: null,
    parent: null,
  });

  const selectorMap = new Map<number, DOMElementNode>();
  const snapshotLinesByIndex = new Map<number, { role?: string; name?: string }>();

  if (args.snapshotTree) {
    for (const line of args.snapshotTree.split('\n')) {
      const parsed = parseSnapshotLine(line);
      if (!parsed) {
        continue;
      }
      snapshotLinesByIndex.set(parsed.index, {
        role: parsed.role,
        name: parsed.name,
      });
    }
  }

  const refs = args.refs ?? {};
  const refEntries = Object.entries(refs)
    .map(([ref, value]) => ({ ref, value, index: Number.parseInt(ref.replace(/^e/i, ''), 10) }))
    .filter(entry => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index);

  for (const entry of refEntries) {
    const lineInfo = snapshotLinesByIndex.get(entry.index);
    const role = lineInfo?.role ?? entry.value.role ?? 'element';
    const name = lineInfo?.name ?? entry.value.name ?? '';
    const node = buildNode({
      index: entry.index,
      role,
      name,
      selector: entry.value.selector,
      nth: entry.value.nth,
      parent: root,
    });
    root.children.push(node);
    selectorMap.set(entry.index, node);
  }

  if (selectorMap.size === 0 && snapshotLinesByIndex.size > 0) {
    const sortedEntries = Array.from(snapshotLinesByIndex.entries()).sort((a, b) => a[0] - b[0]);
    for (const [index, lineInfo] of sortedEntries) {
      const role = lineInfo.role ?? 'element';
      const name = lineInfo.name ?? '';
      const node = buildNode({
        index,
        role,
        name,
        selector: `@e${index}`,
        parent: root,
      });
      root.children.push(node);
      selectorMap.set(index, node);
    }
  }

  return {
    elementTree: root,
    selectorMap,
    tabId: args.tabId,
    url: args.url || args.fallbackState?.url || '',
    title: args.title || args.fallbackState?.title || '',
    screenshot: args.screenshot ?? null,
    scrollY: args.fallbackState?.scrollY ?? 0,
    scrollHeight: args.fallbackState?.scrollHeight ?? 0,
    visualViewportHeight: args.fallbackState?.visualViewportHeight ?? 0,
  };
}
