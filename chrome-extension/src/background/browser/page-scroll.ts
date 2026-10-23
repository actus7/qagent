import type { Page as PuppeteerPage, ElementHandle } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import { createLogger } from '@src/background/log';

const logger = createLogger('Page');

/**
 * Find the nearest scrollable ancestor of the given element
 * @param page The puppeteer page the element belongs to
 * @param element The element to start searching from
 * @returns The nearest scrollable ancestor or null if none found
 */
export async function findNearestScrollableElement(
  page: PuppeteerPage | null,
  element: ElementHandle,
): Promise<ElementHandle | null> {
  if (!page) {
    return null;
  }

  // Check if the current element is scrollable
  const isScrollable = await element.evaluate((el: Element) => {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
    const canScrollVertically =
      style.overflowY === 'scroll' ||
      style.overflowY === 'auto' ||
      style.overflow === 'scroll' ||
      style.overflow === 'auto';

    return hasVerticalScrollbar && canScrollVertically;
  });

  if (isScrollable) {
    return element;
  }

  // Check parent elements
  let currentElement: ElementHandle<Element> | null = element;

  try {
    while (currentElement) {
      // Get the parent element (as an ElementHandle) of the current element
      const parentHandle = (await currentElement.evaluateHandle(
        (el: Element) => el.parentElement,
      )) as ElementHandle<Element> | null;

      const parentElement = parentHandle ? await parentHandle.asElement() : null;

      if (!parentElement) {
        // Reached the root without finding a scrollable ancestor
        currentElement = null;
        break;
      }

      const parentIsScrollable = await parentElement.evaluate((el: Element) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
        const canScrollVertically =
          ['scroll', 'auto'].includes(style.overflowY) || ['scroll', 'auto'].includes(style.overflow);

        return hasVerticalScrollbar && canScrollVertically;
      });

      if (parentIsScrollable) {
        // Found a scrollable ancestor – return it (the caller should dispose when finished)
        return parentElement;
      }

      // Move up the DOM tree – dispose the previous element handle before continuing
      if (currentElement !== element) {
        try {
          await currentElement.dispose();
        } catch (disposeErr) {
          logger.debug('Failed to dispose element handle:', disposeErr);
        }
      }

      currentElement = parentElement;
    }
  } catch (error) {
    // Error accessing parent, break out of loop
    logger.error('Error finding scrollable parent:', error);
  }

  // If no scrollable ancestor found, return the document body or documentElement
  try {
    const bodyElement = await page.$('body');
    if (bodyElement) {
      const bodyIsScrollable = await bodyElement.evaluate(el => {
        if (!(el instanceof HTMLElement)) return false;
        return el.scrollHeight > el.clientHeight;
      });
      if (bodyIsScrollable) {
        return bodyElement;
      }
    }

    // Last resort: return document element for page-level scrolling
    const documentElement = await page.evaluateHandle(() => document.documentElement);
    const docElement = (await documentElement.asElement()) as ElementHandle<Element> | null;
    return docElement;
  } catch (error) {
    logger.error('Failed to find scrollable element:', error);
    return null;
  }
}

/**
 * Wait for an element to become stable (no position/size changes)
 * Similar to Playwright's wait_for_element_state('stable')
 */
export async function waitForElementStability(element: ElementHandle, timeout = 1000): Promise<void> {
  const startTime = Date.now();
  let lastRect = await element.boundingBox();

  while (Date.now() - startTime < timeout) {
    // Wait a short time
    await new Promise(resolve => setTimeout(resolve, 50));

    // Get current position and size
    const currentRect = await element.boundingBox();

    // If element is no longer in DOM or not visible
    if (!currentRect) {
      break;
    }

    // Compare with previous position/size
    if (
      lastRect &&
      Math.abs(lastRect.x - currentRect.x) < 2 &&
      Math.abs(lastRect.y - currentRect.y) < 2 &&
      Math.abs(lastRect.width - currentRect.width) < 2 &&
      Math.abs(lastRect.height - currentRect.height) < 2
    ) {
      // Position is stable - wait a bit more to be sure and then return
      await new Promise(resolve => setTimeout(resolve, 50));
      return;
    }

    // Update last position
    lastRect = currentRect;
  }

  // If we got here, either the element stabilized or we timed out
  logger.debug('Element stability check completed (timeout or stable)');
}

export async function scrollIntoViewIfNeeded(element: ElementHandle, timeout = 1000): Promise<void> {
  const startTime = Date.now();

  while (true) {
    // Check if element is in viewport
    const isVisible = await element.evaluate(el => {
      const rect = el.getBoundingClientRect();

      // Check if element has size
      if (rect.width === 0 || rect.height === 0) return false;

      // Check if element is hidden
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        return false;
      }

      // Check if element is in viewport
      const isInViewport =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth);

      if (!isInViewport) {
        // Scroll into view if not visible
        el.scrollIntoView({
          behavior: 'auto',
          block: 'center',
          inline: 'center',
        });
        return false;
      }

      return true;
    });

    if (isVisible) break;

    // Check timeout - log warning and return instead of throwing
    if (Date.now() - startTime > timeout) {
      logger.warning('Timed out while trying to scroll element into view, continuing anyway');
      break;
    }

    // Small delay before next check
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
