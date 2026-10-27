// Compact text form of Chrome's accessibility tree (CDP Accessibility domain via Puppeteer). Chrome computes roles,
// names and states itself, including inside closed shadow roots and canvas fallback content that the DOM walker
// (buildDomTree) cannot see, so it is a second view of the page when the element list is missing something.

export interface AccessibilityNodeLike {
  role?: string;
  name?: string;
  value?: string | number;
  description?: string;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  expanded?: boolean;
  disabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  required?: boolean;
  level?: number;
  children?: AccessibilityNodeLike[];
}

const NAME_MAX_CHARS = 100;
const STATE_KEYS = ['checked', 'pressed', 'expanded', 'disabled', 'focused', 'selected', 'required'] as const;

function describe(node: AccessibilityNodeLike): string {
  const name = (node.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_CHARS);
  const parts = [node.role ?? 'node'];
  if (name) parts.push(JSON.stringify(name));
  if (node.value !== undefined && node.value !== '') parts.push(`value=${JSON.stringify(String(node.value))}`);
  if (node.level !== undefined) parts.push(`level=${node.level}`);
  const states = STATE_KEYS.filter(key => node[key] !== undefined && node[key] !== false).map(key =>
    node[key] === true ? key : `${key}=${node[key]}`,
  );
  if (states.length > 0) parts.push(`[${states.join(',')}]`);
  return parts.join(' ');
}

/** Indented lines, depth first, stopping after `maxNodes`; the last line says how many were left out. */
export function formatAccessibilityTree(root: AccessibilityNodeLike | null, maxNodes: number): string {
  if (!root) return '(no accessibility tree)';
  const lines: string[] = [];
  let omitted = 0;
  const walk = (node: AccessibilityNodeLike, depth: number, isRoot: boolean): void => {
    // the unnamed root wrapper adds a level without information
    const skip = isRoot && (node.role === 'RootWebArea' || node.role === 'WebArea') && !node.name;
    if (!skip) {
      if (lines.length < maxNodes) lines.push(`${'  '.repeat(depth)}${describe(node)}`);
      else omitted += 1;
    }
    for (const child of node.children ?? []) walk(child, skip ? depth : depth + 1, false);
  };
  walk(root, 0, true);
  if (omitted > 0) lines.push(`... ${omitted} more nodes (raise max_nodes to see them)`);
  return lines.join('\n');
}
