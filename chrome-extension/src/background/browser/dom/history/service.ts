import { DOMElementNode } from '../views';
import { DOMHistoryElement, HashedDomElement } from './view';
import { hashText } from '../hash';

/**
 * Convert a DOM element to a history element
 */
export function convertDomElementToHistoryElement(domElement: DOMElementNode): DOMHistoryElement {
  const parentBranchPath = _getParentBranchPath(domElement);
  const cssSelector = domElement.getEnhancedCssSelector();
  return new DOMHistoryElement(
    domElement.tagName ?? '', // Provide empty string as fallback
    domElement.xpath ?? '', // Provide empty string as fallback
    domElement.highlightIndex ?? null,
    parentBranchPath,
    domElement.attributes,
    domElement.shadowRoot,
    cssSelector,
    domElement.pageCoordinates ?? null,
    domElement.viewportCoordinates ?? null,
    domElement.viewportInfo ?? null,
  );
}

/**
 * Find a history element in the DOM tree
 */
export async function findHistoryElementInTree(
  domHistoryElement: DOMHistoryElement,
  tree: DOMElementNode,
): Promise<DOMElementNode | null> {
  const hashedDomHistoryElement = await hashDomHistoryElement(domHistoryElement);

  const processNode = async (node: DOMElementNode): Promise<DOMElementNode | null> => {
    if (node.highlightIndex != null) {
      const hashedNode = await hashDomElement(node);
      if (
        hashedNode.branchPathHash === hashedDomHistoryElement.branchPathHash &&
        hashedNode.attributesHash === hashedDomHistoryElement.attributesHash &&
        hashedNode.xpathHash === hashedDomHistoryElement.xpathHash
      ) {
        return node;
      }
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) {
        const result = await processNode(child);
        if (result !== null) {
          return result;
        }
      }
    }
    return null;
  };

  return processNode(tree);
}

/**
 * Hash a DOM history element
 */
async function hashDomHistoryElement(domHistoryElement: DOMHistoryElement): Promise<HashedDomElement> {
  const [branchPathHash, attributesHash, xpathHash] = await Promise.all([
    _parentBranchPathHash(domHistoryElement.entireParentBranchPath),
    _attributesHash(domHistoryElement.attributes),
    _xpathHash(domHistoryElement.xpath ?? ''),
  ]);
  return new HashedDomElement(branchPathHash, attributesHash, xpathHash);
}

/**
 * Hash a DOM element
 */
export async function hashDomElement(domElement: DOMElementNode): Promise<HashedDomElement> {
  const parentBranchPath = _getParentBranchPath(domElement);
  const [branchPathHash, attributesHash, xpathHash] = await Promise.all([
    _parentBranchPathHash(parentBranchPath),
    _attributesHash(domElement.attributes),
    _xpathHash(domElement.xpath ?? ''),
  ]);
  return new HashedDomElement(branchPathHash, attributesHash, xpathHash);
}

/**
 * Get the branch path from parent elements
 */
export function _getParentBranchPath(domElement: DOMElementNode): string[] {
  const parents: DOMElementNode[] = [];
  let currentElement: DOMElementNode = domElement;

  while (currentElement.parent != null) {
    parents.push(currentElement);
    currentElement = currentElement.parent;
  }

  parents.reverse();
  return parents.map(parent => parent.tagName ?? '');
}

/**
 * Create a hash from the parent branch path
 */
async function _parentBranchPathHash(parentBranchPath: string[]): Promise<string> {
  if (parentBranchPath.length === 0) return '';
  return hashText(parentBranchPath.join('/'));
}

/**
 * Create a hash from the element attributes
 */
async function _attributesHash(attributes: Record<string, string>): Promise<string> {
  const attributesString = Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join('');
  return hashText(attributesString);
}

/**
 * Create a hash from the element xpath
 */
async function _xpathHash(xpath: string): Promise<string> {
  return hashText(xpath);
}

/**
 * Create a hash from the element text
 */
async function _textHash(domElement: DOMElementNode): Promise<string> {
  const textString = domElement.getAllTextTillNextClickableElement();
  return hashText(textString);
}

/**
 * HistoryTreeProcessor namespace to keep same pattern as in python
 */
export const HistoryTreeProcessor = {
  convertDomElementToHistoryElement,
  findHistoryElementInTree,
  hashDomElement,
  _getParentBranchPath,
  _parentBranchPathHash,
  _attributesHash,
  _xpathHash,
  _textHash,
};
