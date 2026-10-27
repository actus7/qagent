import { DOMElementNode } from '../views';
import { hashText, serializeAttributes } from '../hash';

/**
 * Get all clickable elements in the DOM tree using an iterative approach
 * to avoid "Maximum call stack size exceeded" errors on deep DOMs.
 * This maintains the exact same pre-order traversal as the original recursive version.
 */
export function getClickableElements(domElement: DOMElementNode): DOMElementNode[] {
  const clickableElements: DOMElementNode[] = [];
  const stack: DOMElementNode[] = [];

  // Start with all direct children of the root element (in reverse order for correct processing)
  for (let i = domElement.children.length - 1; i >= 0; i--) {
    const child = domElement.children[i];
    if (child instanceof DOMElementNode) {
      stack.push(child);
    }
  }

  while (stack.length > 0) {
    const node = stack.pop() as DOMElementNode;

    // Process current node first (pre-order: node before children)
    if (node.highlightIndex !== null) {
      clickableElements.push(node);
    }

    // Add children to stack in reverse order so they're processed in document order
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child instanceof DOMElementNode) {
        stack.push(child);
      }
    }
  }

  return clickableElements;
}

/**
 * Hash a DOM element for identification. Synchronous: every input is an in-memory string.
 */
export function hashDomElement(domElement: DOMElementNode): string {
  const branchPathHash = hashText(_getParentBranchPath(domElement).join('/'));
  const attributesHash = hashText(serializeAttributes(domElement.attributes));
  const xpathHash = hashText(domElement.xpath || '');
  return `${branchPathHash}-${attributesHash}-${xpathHash}`;
}

/**
 * Flags the clickable elements that were not clickable in the previous read of the same URL, and returns their
 * hashes so the next read can compare against them. Each element is hashed once.
 */
export function markNewClickableElements(
  domElement: DOMElementNode,
  url: string,
  previous: { url: string; hashes: Set<string> } | null | undefined,
): Set<string> {
  const sameUrl = previous?.url === url;
  const hashes = new Set<string>();
  for (const element of getClickableElements(domElement)) {
    const hash = hashDomElement(element);
    hashes.add(hash);
    if (sameUrl && previous) element.isNew = !previous.hashes.has(hash);
  }
  return hashes;
}

/**
 * Get the branch path from parent elements
 */
function _getParentBranchPath(domElement: DOMElementNode): string[] {
  const parents: DOMElementNode[] = [];
  let currentElement: DOMElementNode | null = domElement;

  while (currentElement?.parent !== null) {
    parents.push(currentElement);
    currentElement = currentElement.parent;
  }

  parents.reverse();

  return parents.map(parent => parent.tagName || '');
}
