import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import { createLogger } from '@src/background/log';
import { scrollIntoViewIfNeeded, waitForElementStability } from './page-scroll';

const logger = createLogger('Page');

/**
 * Prepares an element (waits for stability and scrolls it into view), then fills it with text.
 * Inputs and contenteditable elements are cleared and typed into; other elements get their value set directly.
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

  // Get element properties to determine input method
  const tagName = await element.evaluate(el => el.tagName.toLowerCase());
  const isContentEditable = await element.evaluate(el => {
    if (el instanceof HTMLElement) {
      return el.isContentEditable;
    }
    return false;
  });
  const isReadOnly = await element.evaluate(el => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.readOnly;
    }
    return false;
  });
  const isDisabled = await element.evaluate(el => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.disabled;
    }
    return false;
  });

  // Choose appropriate input method based on element properties
  if ((isContentEditable || tagName === 'input') && !isReadOnly && !isDisabled) {
    // Clear content and set value directly
    await element.evaluate(el => {
      if (el instanceof HTMLElement) {
        el.textContent = '';
      }
      if ('value' in el) {
        (el as HTMLInputElement).value = '';
      }
      // Dispatch events
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Type the text with a small delay between keypresses
    await element.type(text, { delay: 50 });
  } else {
    // Use direct value setting for other types of elements
    await element.evaluate((el, value) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = value;
      } else if (el instanceof HTMLElement && el.isContentEditable) {
        el.textContent = value;
      }
      // Dispatch events
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, text);
  }
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
        el.value = '';
      } else if (el instanceof HTMLElement && el.isContentEditable) {
        el.textContent = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  try {
    await element.type(text, { delay: 50 });
  } catch (error) {
    await element.evaluate(
      (el, payload) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = payload.clearBeforeTyping ? payload.text : `${el.value}${payload.text}`;
        } else if (el instanceof HTMLElement && el.isContentEditable) {
          const current = el.textContent || '';
          el.textContent = payload.clearBeforeTyping ? payload.text : `${current}${payload.text}`;
        } else if (el instanceof HTMLElement) {
          el.textContent = payload.clearBeforeTyping ? payload.text : `${el.textContent || ''}${payload.text}`;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { text, clearBeforeTyping },
    );
    logger.debug(`Type fallback used for selector ${selector}:`, error);
  }
}
