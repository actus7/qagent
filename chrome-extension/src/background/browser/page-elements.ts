import type { Page as PuppeteerPage, ElementHandle, Frame } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import type { DOMElementNode } from './dom/views';
import { createLogger } from '@src/background/log';
import { scrollIntoViewIfNeeded } from './page-scroll';
import { URLNotAllowedError } from './views';

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
    throw new Error(error instanceof Error ? error.message : String(error));
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

      // Set the value and dispatch events
      const previousValue = select.value;
      select.value = option.value;

      // Only dispatch events if the value actually changed
      if (previousValue !== option.value) {
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
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
  page: PuppeteerPage,
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
  page: PuppeteerPage,
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

/**
 * Click with Puppeteer (2s timeout), falling back to a DOM `el.click()`.
 * `afterClick` runs after either path so URL allow-list checks cover the fallback too.
 */
export async function clickWithFallback(
  element: ElementHandle,
  afterClick: () => Promise<void>,
  errorPrefix: string,
): Promise<void> {
  try {
    await Promise.race([
      element.click(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 2000)),
    ]);
    await afterClick();
  } catch (error) {
    if (error instanceof URLNotAllowedError) {
      throw error;
    }
    logger.info('Failed to click element, trying again', error);
    try {
      await element.evaluate(el => (el as HTMLElement).click());
      await afterClick();
    } catch (secondError) {
      if (secondError instanceof URLNotAllowedError) {
        throw secondError;
      }
      throw new Error(`${errorPrefix}: ${secondError instanceof Error ? secondError.message : String(secondError)}`);
    }
  }
}
