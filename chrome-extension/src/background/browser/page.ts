import 'webextension-polyfill';
import {
  connect,
  ExtensionTransport,
  type Browser,
  type Dialog,
  type ElementHandle,
  type KeyInput,
  type Page as PuppeteerPage,
  type ProtocolType,
} from 'puppeteer-core/internal/puppeteer-core-browser.js';
import {
  getClickableElements as _getClickableElements,
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
} from './dom/service';
import type { DOMElementNode, DOMState } from './dom/views';
import { type BrowserContextConfig, DEFAULT_BROWSER_CONTEXT_CONFIG, type PageState, URLNotAllowedError } from './views';
import { createLogger } from '@src/background/log';
import { ClickableElementProcessor } from './dom/clickable/service';
import { isUrlAllowed } from './util';
import { build_initial_state, CachedStateClickableElementsHashes, parseSelectorIndex } from './page-state';
import { parseKeyCombination, convertKey, isMacUserAgent } from './page-keys';
import { typeIntoElementNode, typeIntoSelectorElement } from './page-input';
import { applyAntiDetectionScripts } from './page-anti-detection';
import { findNearestScrollableElement, scrollIntoViewIfNeeded, waitForElementStability } from './page-scroll';
import { waitForStableNetwork } from './page-network';
import { PageTelemetry } from './page-telemetry';
import type { ConsoleEntry, ConsoleReadOptions, NetworkEntry, NetworkReadOptions } from './page-telemetry';
import { centerOfBox, isInsideViewport, readJpegSizeFromBase64, screenshotPointToCss } from './page-pointer';
import type { Point, Size } from './page-pointer';
import { formatEvaluationResponse, JS_EVALUATION_TIMEOUT_MS, withTimeout } from './page-script';
import type { EvaluationOutcome } from './page-script';
import {
  clickWithFallback,
  type DropdownOption,
  locateElementInPage,
  queryElementBySelectorOnPage,
  readSelectOptions,
  scrollToTextOnPage,
  selectOptionByText,
} from './page-elements';

export { build_initial_state, CachedStateClickableElementsHashes };

const logger = createLogger('Page');

interface InputTextBySelectorOptions {
  clearBeforeTyping?: boolean;
}

export default class Page {
  private _tabId: number;
  private _browser: Browser | null = null;
  private _puppeteerPage: PuppeteerPage | null = null;
  private _config: BrowserContextConfig;
  private _state: PageState;
  private _dialogNotices: string[] = [];
  private _validWebPage = false;
  private _cachedState: PageState | null = null;
  private _cachedStateClickableElementsHashes: CachedStateClickableElementsHashes | null = null;
  private _telemetry = new PageTelemetry();
  private _lastScreenshotSize: Size | null = null;
  private _viewportOverridden = false;

  constructor(tabId: number, url: string, title: string, config: Partial<BrowserContextConfig> = {}) {
    this._tabId = tabId;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._state = build_initial_state(tabId, url, title);
    // chrome://newtab/, chrome://newtab/extensions, https://chromewebstore.google.com/ are not valid web pages, can't be attached
    const lowerCaseUrl = url.trim().toLowerCase();
    this._validWebPage =
      (tabId &&
        lowerCaseUrl &&
        lowerCaseUrl.startsWith('http') &&
        !lowerCaseUrl.startsWith('https://chromewebstore.google.com')) ||
      false;
  }

  get tabId(): number {
    return this._tabId;
  }

  get validWebPage(): boolean {
    return this._validWebPage;
  }

  get attached(): boolean {
    return this._validWebPage && this._puppeteerPage !== null;
  }

  async attachPuppeteer(): Promise<boolean> {
    if (!this._validWebPage) {
      return false;
    }

    if (this._puppeteerPage) {
      return true;
    }

    logger.info('attaching puppeteer', this._tabId);
    let transport: ExtensionTransport;
    try {
      transport = await ExtensionTransport.connectTab(this._tabId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Host access is restricted by policy.')) {
        throw new Error(
          'O navegador bloqueou o controle da aba pela API chrome.debugger. ' +
            'Isso também pode ocorrer no Comet sem políticas administrativas configuradas. ' +
            'Use Conversar/Planejar ou execute a tarefa no Chrome/Chromium. ' +
            `Detalhe: ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }
    const browser = await connect({
      transport,
      defaultViewport: null,
      protocol: 'cdp' as ProtocolType,
    });
    this._browser = browser;

    try {
      const [page] = await browser.pages();
      this._puppeteerPage = page;
      page.on('dialog', dialog => this._handleDialog(dialog));
      this._telemetry.attach(page);

      // Add anti-detection scripts
      await this._addAntiDetectionScripts();
    } catch (error) {
      // Release the debugger if setup fails half-way, otherwise it stays attached
      await this.detachPuppeteer();
      throw error;
    }

    return true;
  }

  /**
   * Blocking JS dialogs would hang the page and the task. alert/beforeunload are accepted,
   * confirm/prompt are dismissed; each one is recorded so the next step can report it.
   */
  private _handleDialog(dialog: Dialog): void {
    const type = dialog.type();
    const accept = type === 'alert' || type === 'beforeunload';
    this._dialogNotices.push(
      `JavaScript ${type} dialog "${dialog.message()}" was ${accept ? 'accepted' : 'dismissed'} automatically.`,
    );
    const handled = accept ? dialog.accept() : dialog.dismiss();
    handled.catch(error => logger.warning('Failed to handle JS dialog:', error));
  }

  /** Returns and clears the notices about JS dialogs handled since the last call. */
  takeDialogNotices(): string[] {
    return this._dialogNotices.splice(0);
  }

  private async _addAntiDetectionScripts(): Promise<void> {
    await applyAntiDetectionScripts(this._puppeteerPage);
  }

  async detachPuppeteer(): Promise<void> {
    // Emulated viewport must not outlive the task that set it.
    await this.resetViewport().catch(error => logger.warning('Failed to reset viewport:', error));
    this._telemetry.detach();
    this._lastScreenshotSize = null;
    if (this._browser) {
      try {
        await this._browser.disconnect();
      } catch (error) {
        logger.warning('Failed to disconnect browser while detaching page:', error);
      }
    }

    this._browser = null;
    this._puppeteerPage = null;
    this._state = build_initial_state(this._tabId);
    this._cachedState = null;
    this._cachedStateClickableElementsHashes = null;
  }

  async removeHighlight(): Promise<void> {
    if (this._config.displayHighlights && this._validWebPage) {
      await _removeHighlights(this._tabId);
    }
  }

  async getClickableElements(showHighlightElements: boolean, focusElement: number): Promise<DOMState | null> {
    if (!this._validWebPage) {
      return null;
    }
    return _getClickableElements(
      this._tabId,
      this.url(),
      showHighlightElements,
      focusElement,
      this._config.viewportExpansion,
    );
  }

  // Get scroll position information for the current page.
  async getScrollInfo(): Promise<[number, number, number]> {
    if (!this._validWebPage) {
      return [0, 0, 0];
    }
    return _getScrollInfo(this._tabId);
  }

  // Get scroll position information for a specific element.
  async getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    const element = await this.locateElement(elementNode);
    if (!element) {
      throw new Error(`Element: ${elementNode} not found`);
    }

    // Find the nearest scrollable ancestor
    const scrollableElement = await this._findNearestScrollableElement(element);
    if (!scrollableElement) {
      throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
    }

    const scrollInfo = await scrollableElement.evaluate(el => {
      return {
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });

    return [scrollInfo.scrollTop, scrollInfo.clientHeight, scrollInfo.scrollHeight];
  }

  /**
   * Find the nearest scrollable ancestor of the given element
   * @param element The element to start searching from
   * @returns The nearest scrollable ancestor or null if none found
   */
  private async _findNearestScrollableElement(element: ElementHandle): Promise<ElementHandle | null> {
    return findNearestScrollableElement(this._puppeteerPage, element);
  }

  async getContent(): Promise<string> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    return await this._puppeteerPage.content();
  }

  getCachedState(): PageState | null {
    return this._cachedState;
  }

  async getState(useVision = false, cacheClickableElementsHashes = false): Promise<PageState> {
    if (!this._validWebPage) {
      // return the initial state
      return build_initial_state(this._tabId);
    }
    await this.waitForPageAndFramesLoad();
    const updatedState = await this._updateState(useVision);

    // Find out which elements are new
    // Do this only if url has not changed
    if (cacheClickableElementsHashes) {
      // If we are on the same url as the last state, we can use the cached hashes
      if (
        this._cachedStateClickableElementsHashes &&
        this._cachedStateClickableElementsHashes.url === updatedState.url
      ) {
        // Get clickable elements from the updated state
        const updatedStateClickableElements = ClickableElementProcessor.getClickableElements(updatedState.elementTree);

        // Mark elements as new if they weren't in the previous state
        for (const domElement of updatedStateClickableElements) {
          const hash = await ClickableElementProcessor.hashDomElement(domElement);
          domElement.isNew = !this._cachedStateClickableElementsHashes.hashes.has(hash);
        }
      }

      // In any case, we need to cache the new hashes
      const newHashes = await ClickableElementProcessor.getClickableElementsHashes(updatedState.elementTree);
      this._cachedStateClickableElementsHashes = new CachedStateClickableElementsHashes(updatedState.url, newHashes);
    }

    // Save the updated state as the cached state
    this._cachedState = updatedState;

    return updatedState;
  }

  async _updateState(useVision = false, focusElement = -1): Promise<PageState> {
    try {
      // Test if page is still accessible
      // @ts-expect-error - puppeteerPage is not null, already checked before calling this function
      await this._puppeteerPage.evaluate('1');
    } catch (error) {
      logger.warning('Current page is no longer accessible:', error);
      if (this._browser) {
        const pages = await this._browser.pages();
        if (pages.length > 0) {
          this._puppeteerPage = pages[0];
        } else {
          throw new Error('Browser closed: no valid pages available', { cause: error });
        }
      }
    }

    try {
      await this.removeHighlight();

      // Get DOM content (equivalent to dom_service.get_clickable_elements)
      // This part would need to be implemented based on your DomService logic
      // showHighlightElements is true if either useVision or displayHighlights is true
      const displayHighlights = this._config.displayHighlights || useVision;
      const content = await this.getClickableElements(displayHighlights, focusElement);
      if (!content) {
        logger.warning('Failed to get clickable elements');
        // Return last known good state if available
        return this._state;
      }
      // log the attributes of content object
      if ('selectorMap' in content) {
        logger.debug('content.selectorMap:', content.selectorMap.size);
      } else {
        logger.debug('content.selectorMap: not found');
      }
      if ('elementTree' in content) {
        logger.debug('content.elementTree:', content.elementTree?.tagName);
      } else {
        logger.debug('content.elementTree: not found');
      }

      // Take screenshot if needed
      const screenshot = useVision ? await this.takeScreenshot() : null;
      const [scrollY, visualViewportHeight, scrollHeight] = await this.getScrollInfo();

      // update the state
      this._state.elementTree = content.elementTree;
      this._state.selectorMap = content.selectorMap;
      this._state.url = this._puppeteerPage?.url() || '';
      this._state.title = (await this._puppeteerPage?.title()) || '';
      this._state.screenshot = screenshot;
      this._state.scrollY = scrollY;
      this._state.visualViewportHeight = visualViewportHeight;
      this._state.scrollHeight = scrollHeight;
      return this._state;
    } catch (error) {
      logger.error('Failed to update state:', error);
      // Return last known good state if available
      return this._state;
    }
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    try {
      // First disable animations/transitions
      await this._puppeteerPage.evaluate(() => {
        const styleId = 'puppeteer-disable-animations';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      });

      // Take the screenshot using JPEG format with 80% quality
      const screenshot = await this._puppeteerPage.screenshot({
        fullPage: fullPage,
        encoding: 'base64',
        type: 'jpeg',
        quality: 80, // Good balance between quality and file size
      });

      this._lastScreenshotSize = readJpegSizeFromBase64(screenshot as string);

      // Clean up the style element
      await this._puppeteerPage.evaluate(() => {
        const style = document.getElementById('puppeteer-disable-animations');
        if (style) {
          style.remove();
        }
      });

      return screenshot as string;
    } catch (error) {
      logger.error('Failed to take screenshot:', error);
      throw error;
    }
  }

  url(): string {
    if (this._puppeteerPage) {
      return this._puppeteerPage.url();
    }
    return this._state.url;
  }

  async title(): Promise<string> {
    if (this._puppeteerPage) {
      return await this._puppeteerPage.title();
    }
    return this._state.title;
  }

  async navigateTo(url: string): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }
    logger.info('navigateTo', url);

    // Check if URL is allowed
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goto(url)]);
      logger.info('navigateTo complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Navigation failed:', error);
      throw error;
    }
  }

  async refreshPage(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.reload()]);
      logger.info('Page refresh complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Refresh timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Page refresh failed:', error);
      throw error;
    }
  }

  async goBack(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goBack()]);
      logger.info('Navigation back completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Back navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Could not navigate back:', error);
      throw error;
    }
  }

  async goForward(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goForward()]);
      logger.info('Navigation forward completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Forward navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Could not navigate forward:', error);
      throw error;
    }
  }

  // scroll to a percentage of the page or element
  // if yPercent is 0, scroll to the top of the page, if 100, scroll to the bottom of the page
  // if elementNode is provided, scroll to a percentage of the element
  // if elementNode is not provided, scroll to a percentage of the page
  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    if (!elementNode) {
      await this._puppeteerPage.evaluate(yPercent => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        window.scrollTo({
          top: scrollTop,
          left: window.scrollX,
          behavior: 'smooth',
        });
      }, yPercent);
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate((el, yPercent) => {
        const scrollHeight = el.scrollHeight;
        const viewportHeight = el.clientHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        el.scrollTo({
          top: scrollTop,
          left: el.scrollLeft,
          behavior: 'smooth',
        });
      }, yPercent);
    }
  }

  async scrollBy(y: number, elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    if (!elementNode) {
      await this._puppeteerPage.evaluate(y => {
        window.scrollBy({
          top: y,
          left: 0,
          behavior: 'smooth',
        });
      }, y);
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }
      await scrollableElement.evaluate(el => {
        el.scrollBy({
          top: y,
          left: 0,
          behavior: 'smooth',
        });
      });
    }
  }

  async scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      // Scroll the whole page up by viewport height
      await this._puppeteerPage.evaluate('window.scrollBy(0, -(window.visualViewport?.height || window.innerHeight));');
    } else {
      // Scroll the specific element up by its client height
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate(el => {
        el.scrollBy(0, -el.clientHeight);
      });
    }
  }

  async scrollToNextPage(elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      // Scroll the whole page down by viewport height
      await this._puppeteerPage.evaluate('window.scrollBy(0, (window.visualViewport?.height || window.innerHeight));');
    } else {
      // Scroll the specific element down by its client height
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate(el => {
        el.scrollBy(0, el.clientHeight);
      });
    }
  }

  async sendKeys(keys: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    // Split combination keys (e.g., "Control+A" or "Shift+ArrowLeft")
    const { modifiers, mainKey } = parseKeyCombination(keys);

    // Press modifiers and main key, ensure modifiers are released even if an error occurs.
    try {
      // Press all modifier keys (e.g., Control, Shift, etc.)
      for (const modifier of modifiers) {
        await this._puppeteerPage.keyboard.down(this._convertKey(modifier));
      }
      // Press the main key
      // also wait for stable state
      await Promise.all([
        this._puppeteerPage.keyboard.press(this._convertKey(mainKey)),
        this.waitForPageAndFramesLoad(),
      ]);
      logger.info('sendKeys complete', keys);
    } catch (error) {
      logger.error('Failed to send keys:', error);
      throw new Error(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    } finally {
      // Release all modifier keys in reverse order regardless of any errors in key press.
      for (const modifier of [...modifiers].reverse()) {
        try {
          await this._puppeteerPage.keyboard.up(this._convertKey(modifier));
        } catch (releaseError) {
          logger.error('Failed to release modifier:', modifier, releaseError);
        }
      }
    }
  }

  private _convertKey(key: string): KeyInput {
    return convertKey(key, isMacUserAgent());
  }

  async scrollToText(text: string, nth: number = 1): Promise<boolean> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    return scrollToTextOnPage(this._puppeteerPage, text, nth);
  }

  async getDropdownOptions(index: number): Promise<DropdownOption[]> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    try {
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error('Dropdown element not found');
      }
      return await readSelectOptions(elementHandle);
    } catch (error) {
      throw new Error(`Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    logger.debug(`Attempting to select '${text}' from dropdown`);
    logger.debug(`Element attributes: ${JSON.stringify(element.attributes)}`);
    logger.debug(`Element tag: ${element.tagName}`);

    // Validate that we're working with a select element
    if (element.tagName?.toLowerCase() !== 'select') {
      const msg = `Cannot select option: Element with index ${index} is a ${element.tagName}, not a SELECT`;
      logger.error(msg);
      throw new Error(msg);
    }

    try {
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error(`Dropdown element with index ${index} not found`);
      }
      return await selectOptionByText(elementHandle, text, index);
    } catch (error) {
      const errorMessage = `${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMessage);
      throw new Error(errorMessage, { cause: error });
    }
  }

  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer is not connected');
      return null;
    }
    return locateElementInPage(this._puppeteerPage, element, this._config.includeDynamicAttributes);
  }

  async inputTextElementNode(useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Highlight before typing

      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      await typeIntoElementNode(element, text);

      // Wait for page stability after input
      await this.waitForPageAndFramesLoad();
    } catch (error) {
      const errorMsg = `Failed to input text into element: ${elementNode}. Error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg, { cause: error });
    }
  }

  /**
   * Wait for an element to become stable (no position/size changes)
   * Similar to Playwright's wait_for_element_state('stable')
   */
  private async _waitForElementStability(element: ElementHandle, timeout = 1000): Promise<void> {
    return waitForElementStability(element, timeout);
  }

  private async _scrollIntoViewIfNeeded(element: ElementHandle, timeout = 1000): Promise<void> {
    return scrollIntoViewIfNeeded(element, timeout);
  }

  async clickElementNode(useVision: boolean, elementNode: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Highlight before clicking

      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Scroll element into view if needed
      await this._scrollIntoViewIfNeeded(element);
      await clickWithFallback(element, () => this._checkAndHandleNavigation(), 'Failed to click element');
    } catch (error) {
      if (error instanceof URLNotAllowedError) throw error;
      throw new Error(
        `Failed to click element: ${elementNode}. Error: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  getSelectorMap(): Map<number, DOMElementNode> {
    // If there is no cached state, return an empty map
    if (this._cachedState === null) {
      return new Map();
    }
    // Otherwise return the cached state's selector map
    return this._cachedState.selectorMap;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap.get(index);
    if (!element) return null;
    return await this.locateElement(element);
  }

  getDomElementByIndex(index: number): DOMElementNode | null {
    const selectorMap = this.getSelectorMap();
    return selectorMap.get(index) || null;
  }

  private selectorToIndex(selector: string): number | null {
    return parseSelectorIndex(selector);
  }

  getDomElementBySelector(
    selector: string,
    selectorMap: Map<number, DOMElementNode> = this.getSelectorMap(),
  ): DOMElementNode | null {
    const index = this.selectorToIndex(selector);
    if (index === null) {
      return null;
    }
    return selectorMap.get(index) || null;
  }

  private async queryElementBySelector(selector: string): Promise<ElementHandle | null> {
    return this._puppeteerPage ? queryElementBySelectorOnPage(this._puppeteerPage, selector) : null;
  }

  async getElementBySelector(
    selector: string,
    selectorMap: Map<number, DOMElementNode> = this.getSelectorMap(),
  ): Promise<ElementHandle | null> {
    const domElement = this.getDomElementBySelector(selector, selectorMap);
    if (domElement) {
      return await this.locateElement(domElement);
    }
    return await this.queryElementBySelector(selector);
  }

  async clickBySelector(useVision: boolean, selector: string, elementNode?: DOMElementNode | null): Promise<void> {
    const domElement = elementNode ?? this.getDomElementBySelector(selector);
    if (domElement) {
      await this.clickElementNode(useVision, domElement);
      return;
    }

    const element = await this.getElementBySelector(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    await this._scrollIntoViewIfNeeded(element);
    await clickWithFallback(element, () => this._checkAndHandleNavigation(), `Failed to click selector "${selector}"`);
  }

  async inputTextBySelector(
    useVision: boolean,
    selector: string,
    text: string,
    options: InputTextBySelectorOptions = {},
  ): Promise<void> {
    const { clearBeforeTyping = true } = options;
    const domElement = this.getDomElementBySelector(selector);

    if (domElement && clearBeforeTyping) {
      await this.inputTextElementNode(useVision, domElement, text);
      return;
    }

    const element = domElement ? await this.locateElement(domElement) : await this.getElementBySelector(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    await typeIntoSelectorElement(element, selector, text, clearBeforeTyping);

    await this.waitForPageAndFramesLoad();
  }

  async scrollByDirection(direction: 'up' | 'down' | 'left' | 'right', pixels: number): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    const amount = Math.max(1, Math.abs(pixels));
    const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;

    await this._puppeteerPage.evaluate(
      ({ left, top }) => {
        window.scrollBy({
          left,
          top,
          behavior: 'smooth',
        });
      },
      { left: dx, top: dy },
    );
  }

  async scrollIntoViewBySelector(selector: string): Promise<void> {
    const element = await this.getElementBySelector(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }
    await this._scrollIntoViewIfNeeded(element);
  }

  /**
   * Attach a file to an <input type=file>. The extension cannot read the user's disk, so the file is built
   * in the page from its text content and assigned through DataTransfer, firing input/change like a real pick.
   */
  async uploadFileBySelector(selector: string, file: { name: string; content: string; mimeType?: string }) {
    const element = await this.getElementBySelector(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }
    const accepted = await element.evaluate((el, { name, content, mimeType }) => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'file') return false;
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name, { type: mimeType || 'text/plain' }));
      el.files = transfer.files;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, file);
    if (!accepted) {
      throw new Error(`Element ${selector} is not a file input`);
    }
  }

  async getTextBySelector(selector: string): Promise<string> {
    const element = await this.getElementBySelector(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    return await element.evaluate(el => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return el.value ?? '';
      }
      const asHTMLElement = el as HTMLElement;
      return (asHTMLElement.innerText || el.textContent || '').trim();
    });
  }

  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) {
      return false;
    }

    // Check current element
    if (elementNode.tagName === 'input') {
      // Check for file input attributes
      const attributes = elementNode.attributes;
      // biome-ignore lint/complexity/useLiteralKeys: <explanation>
      if (attributes['type']?.toLowerCase() === 'file' || !!attributes['accept']) {
        return true;
      }
    }

    // Recursively check children
    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if ('tagName' in child) {
          // DOMElementNode type guard
          if (this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  async waitForPageLoadState(timeout?: number) {
    const timeoutValue = timeout || 8000;
    await this._puppeteerPage?.waitForNavigation({ timeout: timeoutValue });
  }

  private async _waitForStableNetwork() {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    await waitForStableNetwork(this._puppeteerPage, this._config);
  }

  async waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
    // Start timing
    const startTime = Date.now();

    // Wait for page load
    try {
      await this._waitForStableNetwork();

      // Check if the loaded URL is allowed
      if (this._puppeteerPage) {
        await this._checkAndHandleNavigation();
      }
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }
      logger.warning('Page load failed, continuing...', error);
    }

    // Calculate remaining time to meet minimum wait time
    const elapsed = (Date.now() - startTime) / 1000; // Convert to seconds
    const minWaitTime = timeoutOverwrite || this._config.minimumWaitPageLoadTime;
    const remaining = Math.max(minWaitTime - elapsed, 0);

    logger.debug(
      `--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`,
    );

    // Sleep remaining time if needed
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000)); // Convert seconds to milliseconds
    }
  }

  readConsoleMessages(options: ConsoleReadOptions): ConsoleEntry[] {
    return this._telemetry.readConsole(options);
  }

  readNetworkRequests(options: NetworkReadOptions): NetworkEntry[] {
    return this._telemetry.readNetwork(options);
  }

  /** Runs a script in the page's main world. Failures are reported as text, not thrown. */
  async evaluateScript(script: string, timeoutMs = JS_EVALUATION_TIMEOUT_MS): Promise<EvaluationOutcome> {
    const page = this._requirePuppeteerPage();
    const session = await page.createCDPSession();
    try {
      const evaluation = session.send('Runtime.evaluate', {
        expression: script,
        awaitPromise: true,
        returnByValue: true,
      });
      // A promise that never settles keeps running after the race ends, so stop the isolate too.
      const response = await withTimeout(evaluation, timeoutMs, () => {
        session.send('Runtime.terminateExecution').catch(() => {});
      });
      return formatEvaluationResponse(response);
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    } finally {
      await session.detach().catch(() => {});
    }
  }

  async setViewportSize(size: Size, mobile: boolean): Promise<void> {
    const page = this._requirePuppeteerPage();
    await page.setViewport({ width: size.width, height: size.height, isMobile: mobile });
    this._viewportOverridden = true;
    this._lastScreenshotSize = null;
  }

  async resetViewport(): Promise<void> {
    if (!this._viewportOverridden || !this._puppeteerPage) return;
    await this._puppeteerPage.setViewport(null);
    this._viewportOverridden = false;
    this._lastScreenshotSize = null;
  }

  /**
   * Converts a point the model read from the screenshot into viewport CSS pixels.
   * With vision off the model had no screenshot, so the point is already in CSS pixels.
   */
  async toViewportPoint(point: Point, fromScreenshot: boolean): Promise<Point> {
    const page = this._requirePuppeteerPage();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const css = screenshotPointToCss(point, fromScreenshot ? this._lastScreenshotSize : null, viewport);
    if (!isInsideViewport(css, viewport)) {
      throw new Error(`point (${point.x}, ${point.y}) is outside the viewport`);
    }
    return css;
  }

  /** Center of an indexed element in CSS pixels, after scrolling it into view. */
  async getElementCenter(index: number): Promise<Point> {
    const element = this.getDomElementByIndex(index);
    if (!element) throw new Error(`element with index ${index} not found`);
    const handle = await this.locateElement(element);
    if (!handle) throw new Error(`element with index ${index} is not on the page`);
    await this._scrollIntoViewIfNeeded(handle);
    const box = await handle.boundingBox();
    if (!box) throw new Error(`element with index ${index} has no visible box`);
    return centerOfBox(box);
  }

  async clickAt(
    point: Point,
    options: { button: 'left' | 'right' | 'middle'; clickCount: number; modifiers: KeyInput[] },
  ): Promise<void> {
    const page = this._requirePuppeteerPage();
    try {
      for (const key of options.modifiers) await page.keyboard.down(key);
      await page.mouse.click(point.x, point.y, { button: options.button, count: options.clickCount });
    } finally {
      for (const key of [...options.modifiers].reverse()) {
        await page.keyboard.up(key).catch(() => {});
      }
    }
    // A click can navigate; enforce the URL policy like the other click paths do.
    await this._checkAndHandleNavigation();
  }

  async hoverAt(point: Point): Promise<void> {
    const page = this._requirePuppeteerPage();
    await page.mouse.move(point.x, point.y);
  }

  async dragBetween(from: Point, to: Point, steps: number): Promise<void> {
    const page = this._requirePuppeteerPage();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    try {
      await page.mouse.move(to.x, to.y, { steps });
    } finally {
      await page.mouse.up();
    }
    await this._checkAndHandleNavigation();
  }

  private _requirePuppeteerPage(): PuppeteerPage {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    return this._puppeteerPage;
  }

  /**
   * Check the current page URL and handle if it's not allowed
   * @throws URLNotAllowedError if the current URL is not allowed
   */
  private async _checkAndHandleNavigation(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    const currentUrl = this._puppeteerPage.url();
    if (!isUrlAllowed(currentUrl, this._config.allowedUrls, this._config.deniedUrls)) {
      const errorMessage = `URL: ${currentUrl} is not allowed`;
      logger.error(errorMessage);

      // about:blank is never blocked by the URL policy, unlike the configured home page
      const safeUrl = 'about:blank';
      logger.info(`Redirecting to safe URL: ${safeUrl}`);

      try {
        await this._puppeteerPage.goto(safeUrl);
      } catch (error) {
        logger.error(`Failed to redirect to safe URL: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new URLNotAllowedError(errorMessage);
    }
  }
}
