import type { Page as PuppeteerPage, ElementHandle, Frame } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import type { DOMElementNode } from './dom/views';
import { createLogger } from '@src/background/log';
import { scrollIntoViewIfNeeded } from './page-scroll';
import { centerOfBox, easedPath } from './page-pointer';

const EASED_APPROACH_PX = 120;
const EASED_STEPS = 8;
const EASED_HOVER_MS = 80;

const logger = createLogger('Page');

export interface DropdownOption {
  index: number;
  text: string;
  value: string;
}

/**
 * Scroll to the nth visible element containing the given text.
 * @returns true when the element was found and scrolled into view
 */
export async function scrollToTextOnPage(page: PuppeteerPage, text: string, nth: number): Promise<boolean> {
  try {
    // Convert text to lowercase for consistent searching
    const lowerCaseText = text.toLowerCase();

    // Try different locator strategies to find all elements containing the text
    const selectors = [
      // Using text selector (equivalent to get_by_text) - for exact text match
      `::-p-text(${text})`,
      // Using XPath selector (contains text) - case insensitive
      `::-p-xpath(//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lowerCaseText}')])`,
    ];

    for (const selector of selectors) {
      try {
        // Use $$ to get all matching elements
        const elements = await page.$$(selector);

        if (elements.length > 0) {
          // Find visible elements and select the nth occurrence
          const visibleElements = [];

          for (const element of elements) {
            const isVisible = await element.evaluate(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0
              );
            });

            if (isVisible) {
              visibleElements.push(element);
            }
          }

          // Check if we have enough visible elements for the requested nth occurrence
          if (visibleElements.length >= nth) {
            const targetElement = visibleElements[nth - 1]; // Convert to 0-indexed
            await scrollIntoViewIfNeeded(targetElement);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll to complete

            // Dispose of all element handles to prevent memory leaks
            for (const element of elements) {
              await element.dispose();
            }

            return true;
          }
        }

        // Dispose of all element handles to prevent memory leaks
        for (const element of elements) {
          await element.dispose();
        }
      } catch (e) {
        logger.debug(`Locator attempt failed: ${e}`);
      }
    }
    return false;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

/** Read every option of a <select> element. Throws when it is not a select or has no options. */
export async function readSelectOptions(elementHandle: ElementHandle): Promise<DropdownOption[]> {
  // Evaluate the select element to get all options
  const options = await elementHandle.evaluate(select => {
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Element is not a select element');
    }

    return Array.from(select.options).map(option => ({
      index: option.index,
      text: option.text, // Not trimming to maintain exact match for selection
      value: option.value,
    }));
  });

  if (!options.length) {
    throw new Error('No options found in dropdown');
  }

  return options;
}

/**
 * Select the option whose trimmed text equals `text`, dispatching change/input events.
 * @returns a human-readable result message (also when the option is not found)
 */
export async function selectOptionByText(
  elementHandle: ElementHandle,
  text: string,
  elementIndex: number,
): Promise<string> {
  // Verify dropdown and select option in one call
  const result = await elementHandle.evaluate(
    (select, optionText, index) => {
      if (!(select instanceof HTMLSelectElement)) {
        return {
          found: false,
          message: `Element with index ${index} is not a SELECT`,
        };
      }

      const options = Array.from(select.options);
      const option = options.find(opt => opt.text.trim() === optionText);

      if (!option) {
        const availableOptions = options.map(o => o.text.trim()).join('", "');
        return {
          found: false,
          message: `Option "${optionText}" not found in dropdown element with index ${index}. Available options: "${availableOptions}"`,
        };
      }

      // Native setter, so framework-controlled selects see the same path a user pick takes
      const previousValue = select.value;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, option.value);

      // Only dispatch events if the value actually changed
      if (previousValue !== option.value) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return {
        found: true,
        message: `Selected option "${optionText}" with value "${option.value}"`,
      };
    },
    text,
    elementIndex,
  );

  logger.debug('Selection result:', result);
  // whether found or not, return the message
  return result.message;
}

/**
 * Resolve a DOM tree node to a live element handle, walking through parent iframes.
 * Falls back to XPath when the CSS selector misses, and scrolls visible elements into view.
 */
export async function locateElementInPage(
  page: PuppeteerPage | Frame,
  element: DOMElementNode,
  includeDynamicAttributes: boolean,
): Promise<ElementHandle | null> {
  let currentFrame: PuppeteerPage | Frame = page;

  // Start with the target element and collect all parents
  const parents: DOMElementNode[] = [];
  let current = element;
  while (current.parent) {
    parents.push(current.parent);
    current = current.parent;
  }

  // Process all iframe parents in sequence (in reverse order - top to bottom)
  const iframes = parents.reverse().filter(item => item.tagName === 'iframe');
  for (const parent of iframes) {
    const cssSelector = parent.enhancedCssSelectorForElement(includeDynamicAttributes);
    const frameElement: ElementHandle | null = await currentFrame.$(cssSelector);
    if (!frameElement) {
      logger.warning(`Could not find iframe with selector: ${cssSelector}`);
      return null;
    }
    const frame: Frame | null = await frameElement.contentFrame();
    if (!frame) {
      logger.warning(`Could not access frame content for selector: ${cssSelector}`);
      return null;
    }
    currentFrame = frame;
    logger.info('currentFrame changed', currentFrame);
  }

  const cssSelector = element.enhancedCssSelectorForElement(includeDynamicAttributes);

  try {
    // Try CSS selector first
    let elementHandle: ElementHandle | null = await currentFrame.$(cssSelector);

    // If CSS selector failed, try XPath
    if (!elementHandle) {
      const xpath = element.xpath;
      if (xpath) {
        try {
          logger.info('Trying XPath selector:', xpath);
          const fullXpath = xpath.startsWith('/') ? xpath : `/${xpath}`;
          const xpathSelector = `::-p-xpath(${fullXpath})`;
          elementHandle = await currentFrame.$(xpathSelector);
        } catch (xpathError) {
          logger.error('Failed to locate element using XPath:', xpathError);
        }
      }
    }

    // If element found, check visibility and scroll into view
    if (elementHandle) {
      const isHidden = await elementHandle.isHidden();
      if (!isHidden) {
        await scrollIntoViewIfNeeded(elementHandle);
      }
      return elementHandle;
    }

    logger.info('elementHandle not located');
  } catch (error) {
    logger.error('Failed to locate element:', error);
  }

  return null;
}

/** Query a raw selector, supporting `xpath=` and `text=` prefixes besides plain CSS. */
export async function queryElementBySelectorOnPage(
  page: PuppeteerPage | Frame,
  selector: string,
): Promise<ElementHandle | null> {
  const normalizedSelector = selector.trim();
  if (!normalizedSelector) {
    return null;
  }

  // Keep lightweight support for common selector formats.
  if (normalizedSelector.startsWith('xpath=')) {
    const xpath = normalizedSelector.slice('xpath='.length).trim();
    if (!xpath) {
      return null;
    }
    const fullXpath = xpath.startsWith('/') ? xpath : `/${xpath}`;
    return await page.$(`::-p-xpath(${fullXpath})`);
  }

  if (normalizedSelector.startsWith('text=')) {
    const text = normalizedSelector.slice('text='.length).trim().replace(/"/g, '\\"');
    if (!text) {
      return null;
    }
    return await page.$(
      `::-p-xpath(//*[contains(normalize-space(translate(string(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')), "${text.toLowerCase()}")])`,
    );
  }

  return await page.$(normalizedSelector);
}

export const QAGENT_OVERLAY_HOST_ID = 'qagent-overlay-host';

/**
 * Page-side: why a click at the centre of the element's visible part would miss it, or null when it would land.
 * The QAgent overlay is ignored, so the agent cursor never blocks a click. Passed to element.evaluate, so it stays self-contained.
 */
export function findClickBlocker(el: Element, overlayId: string): string | null {
  const describe = (node: Element): string => {
    const tag = node.tagName.toLowerCase();
    // Page-controlled names reach the model: keep them short and plain.
    const clean = (value: string) => value.replace(/[^\w-]/g, '').slice(0, 40);
    if (node.id) return `${tag}#${clean(node.id)}`;
    const firstClass = clean((node.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '');
    return firstClass ? `${tag}.${firstClass}` : tag;
  };
  const rect = el.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (right <= left || bottom <= top) return 'outside the viewport; scroll it into view first';
  const hit = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).find(node => node.id !== overlayId);
  if (!hit || hit === el || el.contains(hit)) return null;
  return `covered by ${describe(hit)}`;
}

/** Makes the QAgent overlay inert (not hit-testable) for the length of a click, so the press reaches the page. */
async function setOverlayInert(element: ElementHandle, inert: boolean): Promise<void> {
  await element
    .evaluate(
      (el, overlayId, on) => {
        el.ownerDocument.getElementById(overlayId)?.toggleAttribute('inert', on);
      },
      QAGENT_OVERLAY_HOST_ID,
      inert,
    )
    .catch(() => undefined);
}

/**
 * Click with Puppeteer (2s timeout), falling back to a DOM `el.click()`.
 * Refuses to click when another element covers the target, and names that element so the model can dismiss it.
 */
export async function clickWithFallback(element: ElementHandle, errorPrefix: string): Promise<void> {
  const blocker = await element.evaluate(findClickBlocker, QAGENT_OVERLAY_HOST_ID);
  if (blocker) throw new Error(`${errorPrefix}: the element is ${blocker}. Dismiss it, then retry.`);

  await setOverlayInert(element, true);
  try {
    await Promise.race([
      element.click(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 2000)),
    ]);
  } catch (error) {
    logger.info('Failed to click element, trying again', error);
    try {
      await element.evaluate(el => (el as HTMLElement).click());
    } catch (secondError) {
      throw new Error(`${errorPrefix}: ${secondError instanceof Error ? secondError.message : String(secondError)}`, {
        cause: secondError,
      });
    }
  } finally {
    await setOverlayInert(element, false);
  }
}

/**
 * Click along an eased mouse path from the upper left of the element, after the same cover check as
 * clickWithFallback. Opt-in (BrowserContextConfig.smoothClicks) for sites that watch for teleporting pointers.
 */
export async function easedClick(page: PuppeteerPage, element: ElementHandle, errorPrefix: string): Promise<void> {
  const blocker = await element.evaluate(findClickBlocker, QAGENT_OVERLAY_HOST_ID);
  if (blocker) throw new Error(`${errorPrefix}: the element is ${blocker}. Dismiss it, then retry.`);
  const box = await element.boundingBox();
  if (!box) throw new Error(`${errorPrefix}: the element has no box`);
  const to = centerOfBox(box);
  const from = { x: Math.max(0, to.x - EASED_APPROACH_PX), y: Math.max(0, to.y - EASED_APPROACH_PX) };
  for (const point of easedPath(from, to, EASED_STEPS)) {
    await page.mouse.move(point.x, point.y);
  }
  await new Promise(resolve => setTimeout(resolve, EASED_HOVER_MS));
  await page.mouse.down();
  await page.mouse.up();
}
