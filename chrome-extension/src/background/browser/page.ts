import 'webextension-polyfill';
import { t } from '@extension/i18n';
import {
  connect,
  ExtensionTransport,
  type Browser,
  type Dialog,
  type ElementHandle,
  type Frame,
  type KeyInput,
  type Page as PuppeteerPage,
  type ProtocolType,
} from 'puppeteer-core/internal/puppeteer-core-browser.js';
import {
  getClickableElements as _getClickableElements,
  getClickableElementsInFrame,
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
} from './dom/service';
import type { DOMElementNode, DOMState } from './dom/views';
import { type BrowserContextConfig, DEFAULT_BROWSER_CONTEXT_CONFIG, type PageState } from './views';
import { createLogger } from '@src/background/log';
import { ExtensionConflictError } from '../agent/agents/errors';
import { showAgentPointer } from '../overlay/overlayMessaging';
import { isDebuggerConflictError } from './debugger-conflict';
import { ClickableElementProcessor } from './dom/clickable/service';
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
import { JS_EVALUATION_TIMEOUT_MS, truncateResult, withTimeout } from './page-script';
import type { EvaluationOutcome } from './page-script';
import {
  clickWithFallback,
  type DropdownOption,
  easedClick,
  locateElementInPage,
  queryElementBySelectorOnPage,
  readSelectOptions,
  scrollToTextOnPage,
  selectOptionByText,
} from './page-elements';
import {
  collectTargetCandidates,
  DEFAULT_TARGET_SELECTOR,
  describeTargetSpec,
  isTargetStateSatisfied,
  matchTargetIndexes,
  pickTargetIndex,
  type TargetSpec,
  type TargetState,
} from './target-resolver';
import { collectPageFacts, PAGE_INFO_MAX_HEADINGS, type PageFacts, type PageInfoOptions } from './page-info';
import { collectProgressSignals, type ProgressReport } from './progress';
import type { FrameSummary, FullPageCapture, RawChallenge } from './types';
import { CAPTCHA_VENDORS, inspectCaptchaFrame, matchCaptchaVendor, type CaptchaVendor } from './captcha-vendors';
import { auditContrastSamples, type ContrastSample } from './contrast';
import { captureHeightFor, planScreenshotTiles } from './screenshot-tiles';
import { stitchTiles } from './screenshot-stitch';
import {
  collectContrastSamplesInPage,
  CONTRAST_SCAN_LIMIT,
  readThemeInPage,
  THEME_VARIABLE_LIMIT,
  toContrastSamples,
  type ThemeReport,
} from './page-visual';
import { captchaTokenInPage, readChallengeTilesInPage } from './page-captcha';
import { callSiteToolInPage, parseSiteToolList, readSiteToolsInPage, type SiteToolDescriptor } from './site-tools';
import type { CaptchaWidgetView } from '../services/captcha-solver';

const TARGET_POLL_MS = 250;
const PROGRESS_TEXT_CHARS = 80;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'null';
  }
}

export { build_initial_state, CachedStateClickableElementsHashes };

const logger = createLogger('Page');

interface InputTextBySelectorOptions {
  clearBeforeTyping?: boolean;
}

type ContrastAudit = ReturnType<typeof auditContrastSamples>;

const OVERLAY_HOST_ID = 'qagent-overlay-host';
const CAPTURE_SETTLE_MS = 120;

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
  // A frame chosen with switch_frame; null means the top document. Cleared when the top document navigates.
  private _focusedFrame: Frame | null = null;

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
      // Reported as an extension conflict so the executor stops the task instead of retrying it.
      if (isDebuggerConflictError(error)) {
        throw new ExtensionConflictError(t('bg_errors_debuggerConflict'), error);
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
      page.on('framenavigated', frame => {
        // The focused frame loading new content is a different document: the agent must re-select it.
        if (frame === page.mainFrame() || frame === this._focusedFrame) this._focusedFrame = null;
      });
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
    if (this._focusedFrame) {
      return getClickableElementsInFrame(
        this._focusedFrame,
        showHighlightElements,
        focusElement,
        this._config.viewportExpansion,
      );
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

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goto(url)]);
      logger.info('navigateTo complete');
    } catch (error) {
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
    return locateElementInPage(this._root(), element, this._config.includeDynamicAttributes);
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

      await this._showAgentPointer(element);
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

  /** Glides the agent cursor to the element's center before an action. Failures never stop the action. */
  private async _showAgentPointer(element: ElementHandle): Promise<void> {
    const box = await element.boundingBox().catch(() => null);
    if (box) await showAgentPointer(this._tabId, box.x + box.width / 2, box.y + box.height / 2);
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
      await this._showAgentPointer(element);
      await this._clickHandle(element, 'Failed to click element');
    } catch (error) {
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
    return this._puppeteerPage ? queryElementBySelectorOnPage(this._root(), selector) : null;
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
    await this._showAgentPointer(element);
    await clickWithFallback(element, `Failed to click selector "${selector}"`);
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

    await this._showAgentPointer(element);
    await typeIntoSelectorElement(element, selector, text, clearBeforeTyping);

    await this.waitForPageAndFramesLoad();
  }

  /** Resolves a readable target ({selector, text, role, nth}) to a live element in the current root. */
  async resolveTargetHandle(spec: TargetSpec): Promise<ElementHandle> {
    const root = this._root();
    const candidates = await root.evaluate(collectTargetCandidates, spec.selector ?? null, DEFAULT_TARGET_SELECTOR);
    const position = pickTargetIndex(candidates, spec);
    const handle = await root.evaluateHandle(
      (selector: string | null, index: number, fallback: string) =>
        document.querySelectorAll(selector ?? fallback)[index] ?? null,
      spec.selector ?? null,
      position,
      DEFAULT_TARGET_SELECTOR,
    );
    const element = handle.asElement();
    if (!element) throw new Error(`Target ${describeTargetSpec(spec)} is no longer on the page`);
    return element;
  }

  async clickByTarget(spec: TargetSpec): Promise<void> {
    const element = await this.resolveTargetHandle(spec);
    await this._scrollIntoViewIfNeeded(element);
    await this._showAgentPointer(element);
    await this._clickHandle(element, `Failed to click ${describeTargetSpec(spec)}`);
  }

  async inputTextByTarget(spec: TargetSpec, text: string, clearBeforeTyping: boolean): Promise<void> {
    const element = await this.resolveTargetHandle(spec);
    await this._showAgentPointer(element);
    if (clearBeforeTyping) {
      await typeIntoElementNode(element, text);
    } else {
      await typeIntoSelectorElement(element, describeTargetSpec(spec), text, false);
    }
    await this.waitForPageAndFramesLoad();
  }

  /** Visible text of a readable target, or of the whole document when no target is given. */
  async getTextOf(target?: TargetSpec): Promise<string> {
    if (!target) {
      return this._root().evaluate(() => document.body?.innerText ?? '');
    }
    const element = await this.resolveTargetHandle(target);
    return element.evaluate(el => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return el.value ?? '';
      }
      const asHTMLElement = el as HTMLElement;
      return (asHTMLElement.innerText || el.textContent || '').trim();
    });
  }

  /** Waits until the target reaches `state`. Polls the page; throws when the timeout passes first. */
  async waitForTarget(spec: TargetSpec, state: TargetState, timeoutMs: number): Promise<number> {
    const started = Date.now();
    for (;;) {
      const candidates = await this._root().evaluate(
        collectTargetCandidates,
        spec.selector ?? null,
        DEFAULT_TARGET_SELECTOR,
      );
      const matchingAll = matchTargetIndexes(candidates, spec, { includeHidden: true }).length;
      const matchingVisible = matchTargetIndexes(candidates, spec).length;
      if (isTargetStateSatisfied(state, matchingAll, matchingVisible)) return Date.now() - started;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out after ${timeoutMs} ms waiting for ${describeTargetSpec(spec)} to be ${state}`);
      }
      await new Promise(resolve => setTimeout(resolve, TARGET_POLL_MS));
    }
  }

  async getPageFacts(options: PageInfoOptions): Promise<PageFacts> {
    return this._root().evaluate(collectPageFacts, options.maxPerKind, options.geometry, PAGE_INFO_MAX_HEADINGS);
  }

  async findProgressSignals(): Promise<ProgressReport> {
    return this._root().evaluate(collectProgressSignals, PROGRESS_TEXT_CHARS);
  }

  /** Frames of the tab, top document first. Index 0 is always the top document. */
  async listFrames(): Promise<FrameSummary[]> {
    const frames = this._frameList();
    const top = frames[0];
    const focused = this._focusedFrame ?? top;
    return frames.map((frame, index) => ({
      index,
      url: frame.url(),
      name: frame.name(),
      crossOrigin: index > 0 && originOf(frame.url()) !== originOf(top.url()),
      focused: frame === focused,
    }));
  }

  /** Makes a frame the scope of later snapshots and element actions. Index 0 returns to the top document. */
  async focusFrame(index: number): Promise<FrameSummary> {
    const frame = this._frameList()[index];
    if (!frame) throw new Error(`No frame with index ${index}; list the frames first`);
    this._focusedFrame = index === 0 ? null : frame;
    const summaries = await this.listFrames();
    return summaries[index];
  }

  private _frameList(): Frame[] {
    const page = this._requirePuppeteerPage();
    const top = page.mainFrame();
    return [top, ...page.frames().filter(frame => frame !== top)];
  }

  /** The document element actions run in: the focused frame, or the top page. */
  private _root(): PuppeteerPage | Frame {
    if (this._focusedFrame?.detached) {
      logger.warning('Focused frame was detached; falling back to the top document');
      this._focusedFrame = null;
    }
    return this._focusedFrame ?? this._requirePuppeteerPage();
  }

  private async _clickHandle(element: ElementHandle, errorPrefix: string): Promise<void> {
    if (this._config.smoothClicks) {
      await easedClick(this._requirePuppeteerPage(), element, errorPrefix);
      return;
    }
    await clickWithFallback(element, errorPrefix);
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
  async uploadFileBySelector(
    selector: string,
    file: { name: string; content?: string; base64?: string; mimeType?: string },
  ) {
    const element = await this.getElementBySelector(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }
    const accepted = await element.evaluate((el, { name, content, base64, mimeType }) => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'file') return false;
      // Binary attachments arrive as base64 and are decoded byte-for-byte
      const data = base64 !== undefined ? Uint8Array.from(atob(base64), char => char.charCodeAt(0)) : (content ?? '');
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], name, { type: mimeType || 'text/plain' }));
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
    } catch (error) {
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
    try {
      // Runs on the page's existing connection in the main world. Opening a second CDP session here never completed in the e2e run.
      const value: unknown = await withTimeout(page.evaluate(script), timeoutMs, () => {});
      return { ok: true, text: truncateResult(JSON.stringify(value) ?? String(value)) };
    } catch (error) {
      return { ok: false, text: truncateResult(error instanceof Error ? error.message : String(error)) };
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
    await showAgentPointer(this._tabId, point.x, point.y);
    try {
      for (const key of options.modifiers) await page.keyboard.down(key);
      await page.mouse.click(point.x, point.y, { button: options.button, count: options.clickCount });
    } finally {
      for (const key of [...options.modifiers].reverse()) {
        await page.keyboard.up(key).catch(() => {});
      }
    }
  }

  async hoverAt(point: Point): Promise<void> {
    const page = this._requirePuppeteerPage();
    await showAgentPointer(this._tabId, point.x, point.y);
    await page.mouse.move(point.x, point.y);
  }

  async dragBetween(from: Point, to: Point, steps: number): Promise<void> {
    const page = this._requirePuppeteerPage();
    await showAgentPointer(this._tabId, from.x, from.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    try {
      await page.mouse.move(to.x, to.y, { steps });
    } finally {
      await page.mouse.up();
    }
  }

  /**
   * Whole-page screenshot. CDP captureBeyondViewport first (one image, no scrolling); when the debugger refuses,
   * the page is scrolled through viewport tiles and stitched. The agent overlay is hidden for the capture.
   */
  async captureFullPage(): Promise<FullPageCapture> {
    const page = this._requirePuppeteerPage();
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
    }));
    const { height, truncated } = captureHeightFor(metrics.height);
    await this._setOverlayHidden(true);
    try {
      try {
        const shot = (await chrome.debugger.sendCommand({ tabId: this._tabId }, 'Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: metrics.width, height, scale: 1 },
        })) as { data?: string };
        if (!shot.data) throw new Error('empty capture');
        return { base64: shot.data, width: metrics.width, height, method: 'cdp', truncated };
      } catch (error) {
        logger.warning('CDP full-page capture failed, stitching viewport tiles:', error);
      }
      const tiles = planScreenshotTiles(height, metrics.viewportHeight);
      const base64 = await stitchTiles(
        tiles,
        {
          grab: async scrollY => {
            await page.evaluate(y => window.scrollTo(0, y), scrollY);
            await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS));
            return (await page.screenshot({ encoding: 'base64', type: 'png' })) as string;
          },
        },
        { width: metrics.width, height, viewportWidth: metrics.viewportWidth },
      );
      await page.evaluate(y => window.scrollTo(0, y), metrics.scrollY);
      return { base64, width: metrics.width, height, method: 'tiles', truncated };
    } finally {
      await this._setOverlayHidden(false);
    }
  }

  private async _setOverlayHidden(hidden: boolean): Promise<void> {
    await this._requirePuppeteerPage()
      .evaluate(
        (id, isHidden) => {
          const host = document.getElementById(id);
          if (host) host.style.display = isHidden ? 'none' : '';
        },
        OVERLAY_HOST_ID,
        hidden,
      )
      .catch(() => undefined);
  }

  /** Tools the page registered through navigator.modelContext (WebMCP). Runs in the MAIN world. */
  async listSiteTools(): Promise<{ api: string | null; tools: SiteToolDescriptor[] }> {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: this._tabId },
      world: 'MAIN',
      func: readSiteToolsInPage,
    });
    const value = injected?.result;
    if (!value) throw new Error('The page did not return its tool list');
    if ('error' in value) throw new Error(value.error);
    return { api: value.api, tools: parseSiteToolList(JSON.parse(value.json) as unknown) };
  }

  /** Runs one site tool. Resolves to the tool's JSON result text. */
  async callSiteTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<string> {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: this._tabId },
      world: 'MAIN',
      func: callSiteToolInPage,
      args: [name, args, timeoutMs],
    });
    const value = injected?.result;
    if (!value) throw new Error('The page did not return a result');
    if (!value.ok) throw new Error(value.error);
    return value.json;
  }

  async readTheme(): Promise<ThemeReport> {
    return this._requirePuppeteerPage().evaluate(readThemeInPage, THEME_VARIABLE_LIMIT);
  }

  /** Text elements whose color pair fails WCAG AA. Colors are composited in Node, see page-visual.ts. */
  async auditContrast(maxSamples: number): Promise<ContrastAudit> {
    const raw = await this._requirePuppeteerPage().evaluate(
      collectContrastSamplesInPage,
      maxSamples,
      CONTRAST_SCAN_LIMIT,
    );
    const samples: ContrastSample[] = toContrastSamples(raw);
    return auditContrastSamples(samples);
  }

  /** Captcha widgets in the page: one per vendor frame that holds a checkbox. */
  async captchaWidgets(): Promise<CaptchaWidgetView[]> {
    const views: CaptchaWidgetView[] = [];
    for (const [frameIndex, frame] of this._frameList().entries()) {
      const spec = matchCaptchaVendor(frame.url());
      if (!spec) continue;
      const facts = await frame.evaluate(inspectCaptchaFrame, spec.checkboxSelector).catch(() => null);
      if (!facts) continue;
      const challengeOpen = await this._challengeFrameVisible(spec.vendor);
      views.push({ frameIndex, vendor: spec.vendor, checkbox: facts.checkbox, checked: facts.checked, challengeOpen });
    }
    return views;
  }

  private async _challengeFrameVisible(vendor: CaptchaVendor): Promise<boolean> {
    const challenge = CAPTCHA_VENDORS.find(item => item.vendor === vendor)?.challengeFrameUrl;
    if (!challenge) return false;
    const frame = this._frameList().find(item => challenge.test(item.url()));
    const element = frame ? await frame.frameElement() : null;
    const box = element ? await element.boundingBox() : null;
    return box !== null && box.width > 0 && box.height > 0;
  }

  async captchaSolved(): Promise<boolean> {
    if (await this._requirePuppeteerPage().evaluate(captchaTokenInPage)) return true;
    return (await this.captchaWidgets()).some(widget => widget.checked);
  }

  /** Clicks a widget's checkbox through CDP, so the click is trusted. */
  async clickCaptchaCheckbox(frameIndex: number): Promise<void> {
    const frame = this._frameList()[frameIndex];
    const spec = frame ? matchCaptchaVendor(frame.url()) : null;
    if (!frame || !spec) throw new Error(`Frame ${frameIndex} is not a captcha widget`);
    const box = await frame.$(spec.checkboxSelector);
    if (!box) throw new Error(`The ${spec.vendor} checkbox is not in frame ${frameIndex}`);
    await box.click();
  }

  /** The open reCAPTCHA image challenge, if any: a screenshot of its frame and the tile boxes inside it. */
  async captchaChallenge(): Promise<RawChallenge | null> {
    const frame = this._challengeFrame('recaptcha');
    if (!frame || !(await this._challengeFrameVisible('recaptcha'))) return null;
    const element = await frame.frameElement();
    if (!element) return null;
    const image = (await element.screenshot({ encoding: 'base64', type: 'png' })) as string;
    const { instruction, tiles } = await frame.evaluate(readChallengeTilesInPage);
    return { image, instruction, tiles: tiles.map((tile, index) => ({ label: index + 1, ...tile })) };
  }

  /** Clicks the tiles with these 1-based labels, then presses reCAPTCHA's verify button. */
  async submitCaptchaTiles(labels: number[]): Promise<void> {
    const frame = this._challengeFrame('recaptcha');
    if (!frame) throw new Error('No captcha challenge is open');
    const tiles = await frame.$$('.rc-imageselect-tile');
    for (const label of labels) {
      const tile = tiles[label - 1];
      if (!tile) throw new Error(`Tile ${label} does not exist`);
      await tile.click();
    }
    const verify = await frame.$('#recaptcha-verify-button');
    if (!verify) throw new Error('The verify button is missing from the challenge');
    await verify.click();
  }

  private _challengeFrame(vendor: CaptchaVendor): Frame | undefined {
    const challenge = CAPTCHA_VENDORS.find(item => item.vendor === vendor)?.challengeFrameUrl;
    return challenge ? this._frameList().find(item => challenge.test(item.url())) : undefined;
  }

  /** Attaches a file from a local path through CDP DOM.setFileInputFiles, e.g. a path from list_downloads. */
  async uploadFileByPath(selector: string, filePath: string): Promise<void> {
    const element = await this.getElementBySelector(selector);
    if (!element) throw new Error(`Element not found for selector: ${selector}`);
    const isFileInput = await element.evaluate(el => el instanceof HTMLInputElement && el.type === 'file');
    if (!isFileInput) throw new Error(`Element ${selector} is not a file input`);
    await chrome.debugger.sendCommand({ tabId: this._tabId }, 'DOM.setFileInputFiles', {
      files: [filePath],
      objectId: element.remoteObject().objectId,
    });
  }

  private _requirePuppeteerPage(): PuppeteerPage {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    return this._puppeteerPage;
  }
}
