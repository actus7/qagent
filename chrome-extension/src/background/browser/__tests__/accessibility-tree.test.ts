import { describe, expect, it } from 'vitest';
import { formatAccessibilityTree } from '../accessibility-tree';
import { readPngSizeFromBase64 } from '../page-pointer';
import { hashText } from '../dom/hash';

describe('formatAccessibilityTree', () => {
  it('lists roles, names and states indented, without the unnamed root', () => {
    const tree = {
      role: 'RootWebArea',
      children: [
        { role: 'heading', name: 'Checkout', level: 1 },
        { role: 'group', name: 'Shipping', children: [{ role: 'checkbox', name: 'Gift', checked: true }] },
        { role: 'button', name: 'Pay', disabled: true },
      ],
    };

    expect(formatAccessibilityTree(tree, 10)).toBe(
      ['heading "Checkout" level=1', 'group "Shipping"', '  checkbox "Gift" [checked]', 'button "Pay" [disabled]'].join(
        '\n',
      ),
    );
  });

  it('stops at maxNodes and says how many nodes were left out', () => {
    const tree = {
      role: 'RootWebArea',
      children: [
        { role: 'link', name: 'a' },
        { role: 'link', name: 'b' },
      ],
    };
    expect(formatAccessibilityTree(tree, 1)).toBe('link "a"\n... 1 more nodes (raise max_nodes to see them)');
  });
});

describe('readPngSizeFromBase64', () => {
  it('reads width and height from the IHDR chunk', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 1280);
    view.setUint32(20, 720);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(readPngSizeFromBase64(base64)).toEqual({ width: 1280, height: 720 });
  });

  it('returns null for data that is not a PNG', () => {
    expect(readPngSizeFromBase64(btoa('not a png at all, really'))).toBeNull();
  });
});

describe('hashText', () => {
  it('is stable and tells different inputs apart', () => {
    expect(hashText('div/button')).toBe(hashText('div/button'));
    expect(hashText('div/button')).not.toBe(hashText('div/a'));
    expect(hashText('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});
