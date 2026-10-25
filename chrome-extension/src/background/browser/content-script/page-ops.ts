/**
 * Page-side operations for the content-script engine. Each export is handed to chrome.scripting.executeScript,
 * which serialises the function, so every one must stay self-contained: no references to module-level names,
 * only globals. Host-side code (run-in-page.ts, page.ts) wires them up.
 */

/** Where an element lives in the top document: an XPath from the DOM tree, or a raw CSS selector. */
export type PageLocator = { xpath: string } | { css: string };

export type PageOutcome = { ok: true } | { ok: false; error: string };

export type ClickOutcome = { ok: true; x: number; y: number } | { ok: false; error: string };

export type TextOutcome = { ok: true; text: string } | { ok: false; error: string };

export interface SelectOption {
  index: number;
  text: string;
  value: string;
}

export type OptionsOutcome = { ok: true; options: SelectOption[] } | { ok: false; error: string };

export type SelectOutcome = { ok: true; selected: string } | { ok: false; error: string };

/** Lists at most this many option labels in an error, so a long select cannot flood the model's context. */
const MAX_LISTED_OPTIONS = 30;

export function clickInPage(locator: PageLocator, overlayId: string): ClickOutcome {
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof Element)) return { ok: false, error: 'element not found in the page' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return { ok: false, error: 'element is outside the viewport' };
  }
  // Mirrors findClickBlocker: the QAgent overlay is ignored, anything else over the centre blocks the click.
  const hit = document.elementsFromPoint(x, y).find(node => node.id !== overlayId);
  if (hit && hit !== el && !el.contains(hit)) {
    const name = hit.tagName.toLowerCase() + (hit.id ? `#${hit.id.replace(/[^\w-]/g, '').slice(0, 40)}` : '');
    return { ok: false, error: `element is covered by ${name}. Dismiss it, then retry.` };
  }
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
  const pointer = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', pointer));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  (el as HTMLElement).focus?.();
  el.dispatchEvent(new PointerEvent('pointerup', pointer));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  el.dispatchEvent(new MouseEvent('click', init));
  return { ok: true, x, y };
}

/** Writes text through the native value setter, so React and other controlled inputs see the change. */
export function writeTextInPage(locator: PageLocator, text: string, clearFirst: boolean): PageOutcome {
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof Element)) return { ok: false, error: 'element not found in the page' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  (el as HTMLElement).focus?.();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.readOnly || el.disabled) return { ok: false, error: 'field is read-only or disabled' };
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nextValue = clearFirst ? text : el.value + text;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, nextValue);
    else el.value = nextValue;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!clearFirst) selection?.collapseToEnd();
    if (document.execCommand('insertText', false, text)) return { ok: true };
    // Editors that refuse execCommand get the text set directly, announced as an input event.
    el.textContent = clearFirst ? text : (el.textContent ?? '') + text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    return { ok: true };
  }
  return { ok: false, error: 'element is not a text field' };
}

/**
 * Dispatches a keyboard press on the focused element. Synthetic key events do not type characters, so use fill for
 * text; Enter in a text field submits its form, which synthetic events would not do on their own.
 */
export function pressKeyInPage(key: string, modifiers: string[]): PageOutcome {
  const target: EventTarget = document.activeElement ?? document.body;
  const init = {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: modifiers.includes('Control'),
    shiftKey: modifiers.includes('Shift'),
    altKey: modifiers.includes('Alt'),
    metaKey: modifiers.includes('Meta'),
  };
  const proceed = target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  if (proceed && key === 'Enter' && target instanceof HTMLInputElement && target.form) {
    target.form.requestSubmit();
  }
  return { ok: true };
}

export function scrollByInPage(dx: number, dy: number): void {
  window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
}

export function scrollToPercentInPage(yPercent: number): void {
  const viewport = window.visualViewport?.height || window.innerHeight;
  const top = (document.documentElement.scrollHeight - viewport) * (yPercent / 100);
  window.scrollTo({ top: Math.max(0, top), left: window.scrollX, behavior: 'instant' });
}

export function scrollIntoViewInPage(locator: PageLocator): PageOutcome {
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof Element)) return { ok: false, error: 'element not found in the page' };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return { ok: true };
}

/** Scrolls to the nth text node containing `text` (case-insensitive). Returns false when there are fewer matches. */
export function scrollToTextInPage(text: string, nth: number): boolean {
  if (!document.body) return false;
  const needle = text.toLowerCase();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? '').toLowerCase().includes(needle)) continue;
    seen += 1;
    if (seen === nth) {
      node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    }
  }
  return false;
}

/** Visible text of an element, or of the whole document when no locator is given. */
export function readTextInPage(locator: PageLocator | null): TextOutcome {
  if (!locator) return { ok: true, text: document.body?.innerText ?? '' };
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof Element)) return { ok: false, error: 'element not found in the page' };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return { ok: true, text: el.value };
  const text = (el as HTMLElement).innerText || el.textContent || '';
  return { ok: true, text: text.trim() };
}

export function readSelectOptionsInPage(locator: PageLocator): OptionsOutcome {
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof HTMLSelectElement)) return { ok: false, error: 'element is not a <select>' };
  const options = Array.from(el.options, option => ({
    index: option.index,
    text: option.text.trim(),
    value: option.value,
  }));
  return { ok: true, options };
}

/** Picks an option by its label: exact match first, then a substring match. Fires input and change like a user would. */
export function selectOptionInPage(locator: PageLocator, wanted: string): SelectOutcome {
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof HTMLSelectElement)) return { ok: false, error: 'element is not a <select>' };
  const target = wanted.trim().toLowerCase();
  const labels = Array.from(el.options, option => option.text.trim());
  const match =
    Array.from(el.options).find(option => option.text.trim().toLowerCase() === target) ??
    Array.from(el.options).find(option => option.text.trim().toLowerCase().includes(target));
  if (!match) {
    const listed = labels.slice(0, MAX_LISTED_OPTIONS).join(', ');
    return { ok: false, error: `no option matches "${wanted}". Options: ${listed}` };
  }
  el.value = match.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, selected: match.text.trim() };
}

/** Attaches a file to a file input through a DataTransfer, then fires input and change. */
export function attachFileInPage(locator: PageLocator, name: string, base64: string, mimeType: string): PageOutcome {
  const el =
    'css' in locator
      ? document.querySelector(locator.css)
      : document.evaluate(locator.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!(el instanceof HTMLInputElement) || el.type !== 'file')
    return { ok: false, error: 'element is not a file input' };
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], name, { type: mimeType || 'application/octet-stream' }));
  el.files = transfer.files;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

/**
 * Runs a script in the page's main world. Pages with a CSP that forbids eval reject it, which is reported as an error.
 * The value is returned as JSON text, or the error message.
 */
export async function evaluateInPage(code: string): Promise<{ ok: boolean; text: string }> {
  try {
    const value: unknown = await (0, eval)(code);
    return { ok: true, text: JSON.stringify(value) ?? String(value) };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}
