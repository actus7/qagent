import type { ElementHandle } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import { createLogger } from '@src/background/log';
import { scrollIntoViewIfNeeded, waitForElementStability } from './page-scroll';

const logger = createLogger('Page');

/**
 * Prepares an element (waits for stability and scrolls it into view), then fills it with text.
 * Inputs and textareas are cleared through the native setter and typed into key by key, so controlled
 * fields see real keystrokes. Contenteditable regions take the text through execCommand, which rich editors
 * (Lexical, Draft.js, ProseMirror) treat like a paste.
 */
export async function typeIntoElementNode(element: ElementHandle, text: string): Promise<void> {
  // Ensure element is ready for input
  try {
    // First wait for element stability
    await waitForElementStability(element, 1500);

    // Then check visibility and scroll into view if needed
    const isHidden = await element.isHidden();
    if (!isHidden) {
      await scrollIntoViewIfNeeded(element, 1500);
    }
  } catch (e) {
    // Continue even if these operations fail
    logger.debug(`Non-critical error preparing element: ${e}`);
  }

  const kind = await element.evaluate(el => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.readOnly || el.disabled ? 'other' : 'field';
    }
    return el instanceof HTMLElement && el.isContentEditable ? 'editable' : 'other';
  });

  if (kind === 'field') {
    await element.evaluate(el => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      }
    });
    // Type the text with a small delay between keypresses
    await element.type(text, { delay: 50 });
    await element.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    return;
  }

  if (kind === 'editable') {
    await element.evaluate((el, value) => {
      const htmlEl = el as HTMLElement;
      htmlEl.focus();
      const range = document.createRange();
      range.selectNodeContents(htmlEl);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      // execCommand fires beforeinput and input like a paste; the fallback covers engines that refuse it.
      if (!document.execCommand('insertText', false, value)) {
        htmlEl.textContent = value;
        htmlEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      }
      htmlEl.dispatchEvent(new Event('change', { bubbles: true }));
    }, text);
    return;
  }

  // Read-only or disabled targets: still write the value, as before, but through the native setter.
  await element.evaluate((el, value) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      el.textContent = value;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
}

/**
 * Types text into an element located by selector. Optionally clears the element first.
 * Falls back to setting the text content directly if keyboard typing fails.
 */
export async function typeIntoSelectorElement(
  element: ElementHandle,
  selector: string,
  text: string,
  clearBeforeTyping: boolean,
): Promise<void> {
  try {
    await waitForElementStability(element, 1500);
    await scrollIntoViewIfNeeded(element, 1500);
  } catch (error) {
    logger.debug(`Non-critical error preparing selector ${selector}: ${error}`);
  }

  if (clearBeforeTyping) {
    await element.evaluate(el => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      } else if (el instanceof HTMLElement && el.isContentEditable) {
        el.textContent = '';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  try {
    await element.type(text, { delay: 50 });
  } catch (error) {
    await element.evaluate(
      (el, payload) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const next = payload.clearBeforeTyping ? payload.text : `${el.value}${payload.text}`;
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
        } else if (el instanceof HTMLElement && el.isContentEditable) {
          const current = el.textContent || '';
          el.textContent = payload.clearBeforeTyping ? payload.text : `${current}${payload.text}`;
        } else if (el instanceof HTMLElement) {
          el.textContent = payload.clearBeforeTyping ? payload.text : `${el.textContent || ''}${payload.text}`;
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { text, clearBeforeTyping },
    );
    logger.debug(`Type fallback used for selector ${selector}:`, error);
  }
}
