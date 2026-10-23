import { describe, expect, it } from 'vitest';
import { classifySensitiveAction, findSensitiveKeyword, normalizeForMatch } from '../permissions/sensitiveActions';

describe('sensitive action classifier', () => {
  it.each([
    ['click', { intent: 'Click the buy button', target: null }, true],
    ['click_element', { intent: 'Add to cart', target: { text: 'Comprar agora' } }, true],
    ['click_element', { intent: '', target: { text: 'Pay now' } }, true],
    ['click_element', { intent: '', target: { ariaLabel: 'Delete account' } }, true],
    ['click_element', { intent: '', target: { text: 'Finalizar pedido' } }, true],
    ['click_element', { intent: '', target: { text: 'Excluir conta' } }, true],
    ['click_element', { intent: '', target: { text: 'Publicar' } }, true],
    ['click_element', { intent: '', target: { text: 'Transferir' } }, true],
    ['click_element', { intent: '', target: { text: 'Enviar' } }, true],
    ['click_element', { intent: '', target: { text: 'Remove from list' } }, true],
    ['click_element', { intent: '', target: { text: 'Send message' } }, true],
    ['click_element', { intent: '', target: { role: 'button', text: 'Checkout' } }, true],
    ['click_element', { intent: '', target: { text: 'Read more' } }, false],
    ['click_element', { intent: 'Open the menu', target: { text: 'Menu' } }, false],
    // Word boundaries: "posts" and "orders list" are not the keywords "post" and "order" as a whole word.
    ['click_element', { intent: '', target: { text: 'View posts' } }, false],
    ['click_element', { intent: '', target: { text: 'Pedidos anteriores' } }, false],
  ])('%s with %j is sensitive=%s', (action, input, expected) => {
    expect(classifySensitiveAction({ action, ...input }).sensitive).toBe(expected);
  });

  it.each([
    ['fill', { type: 'password' }],
    ['input_text', { type: 'password' }],
    ['type', { autocomplete: 'current-password' }],
    ['fill', { autocomplete: 'cc-number' }],
    ['input_text', { autocomplete: 'new-password' }],
  ])('%s into a secret field (%j) is sensitive', (action, target) => {
    const result = classifySensitiveAction({ action, target });
    expect(result.sensitive).toBe(true);
    expect(result.reasons).toContain('secret_field');
  });

  it('keeps a plain text field non-sensitive', () => {
    expect(classifySensitiveAction({ action: 'fill', target: { type: 'text', name: 'city' } }).sensitive).toBe(false);
  });

  it.each(['execute_javascript', 'upload_file'])('%s is always sensitive', action => {
    expect(classifySensitiveAction({ action, target: null })).toEqual({
      sensitive: true,
      reasons: [expect.any(String)],
    });
  });

  it('reports the matched keyword in the reasons', () => {
    expect(classifySensitiveAction({ action: 'click', intent: 'Confirmar compra' }).reasons).toEqual([
      'keyword:confirmar compra',
    ]);
  });
});

describe('keyword matching', () => {
  it.each([
    ['Comprar já', 'comprar'],
    ['PAGAR', 'pagar'],
    ['Transferência', 'transferencia'],
    ['Excluír', 'excluir'],
    ['Finalizar   compra', 'finalizar compra'],
  ])('normalizes and matches "%s" as %s', (text, keyword) => {
    expect(normalizeForMatch(text)).toContain(keyword);
    expect(findSensitiveKeyword(text)).not.toBeNull();
  });

  it('returns null for empty or unrelated text', () => {
    expect(findSensitiveKeyword(undefined)).toBeNull();
    expect(findSensitiveKeyword('')).toBeNull();
    expect(findSensitiveKeyword('Scroll to the footer')).toBeNull();
  });
});
