import { getClickableElements, getScrollInfo, removeHighlights } from '../dom/service';
import { markNewClickableElements } from '../dom/clickable/service';
import type { DOMElementNode } from '../dom/views';
import { build_initial_state, CachedStateClickableElementsHashes, parseSelectorIndex } from '../page-state';
import { parseKeyCombination } from '../page-keys';
import { JS_EVALUATION_TIMEOUT_MS, truncateResult, withTimeout, type EvaluationOutcome } from '../page-script';
import { QAGENT_OVERLAY_HOST_ID } from '../page-elements';
import type { BrowserContextConfig, PageState } from '../views';
import type { BrowserPageLike } from '../types';
import { showAgentPointer } from '../../overlay/overlayMessaging';
import {
  attachFileInPage,
  clickInPage,
  evaluateInPage,
  pressKeyInPage,
  readSelectOptionsInPage,
  readTextInPage,
  scrollByInPage,
  scrollIntoViewInPage,
  scrollToPercentInPage,
  scrollToTextInPage,
  selectOptionInPage,
  writeTextInPage,
  type PageLocator,
} from './page-ops';
import { runInPage, waitForTabComplete } from './run-in-page';
import { installDialogGuard, setNextDialogAnswer, takeRecordedDialogs } from './dialogs';
import { wrapUntrustedContent } from '../../agent/messages/utils';
import { createLogger } from '@src/background/log';

const logger = createLogger('ContentScriptPage');

const UNSUPPORTED_ON_ENGINE = 'not supported by the content-script engine';
const PAGE_SCROLL_RATIO = 0.9;
const JPEG_QUALITY = 80;
const MODIFIER_NAMES: Record<string, string> = {
  control: 'Control',
  ctrl: 'Control',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
};
const KEY_NAMES: Record<string, string> = {
  enter: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  space: ' ',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

/** Maps a key name the agent may use (e.g. "esc", "Control") to the value KeyboardEvent expects. */
function toKeyName(key: string): string {
  return KEY_NAMES[key.toLowerCase()] ?? key;
}

function toModifierNames(modifiers: string[]): string[] {
  return modifiers.map(modifier => MODIFIER_NAMES[modifier.toLowerCase()] ?? modifier);
}

/** Element locator for a DOM tree node. Nodes inside iframes cannot be reached from the top frame. */
function locatorOfNode(node: DOMElementNode): PageLocator {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.tagName === 'iframe') throw new Error(`Elements inside iframes are ${UNSUPPORTED_ON_ENGINE}`);
  }
  if (!node.xpath) throw new Error('Element has no XPath to locate it by');
  return { xpath: node.xpath.startsWith('/') ? node.xpath : `/${node.xpath}` };
}

function directionDelta(direction: 'up' | 'down' | 'left' | 'right', pixels: number): { dx: number; dy: number } {
  const amount = Math.max(1, Math.abs(pixels));
  const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
  return { dx, dy };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

/**
 * A browser page driven without chrome.debugger: DOM state comes from the injected buildDomTree script, and every
 * action runs as a page-side function through chrome.scripting. Anything that needs CDP is left out, so the
 * action builder never offers it on this engine.
 */
export default class ContentScriptPage implements BrowserPageLike {
  readonly tabId: number;
  private currentUrl: string;
  private currentTitle: string;
  private cachedState: PageState | null = null;
  private cachedHashes: CachedStateClickableElementsHashes | null = null;
  private readonly getConfig: () => BrowserContextConfig;

  constructor(tabId: number, url: string, title: string, getConfig: () => BrowserContextConfig) {
    this.tabId = tabId;
    this.currentUrl = url;
    this.currentTitle = title;
    this.getConfig = getConfig;
  }

  // Scripting is per call, so the page is always "attached"; this also makes navigateTo use the page path.
  get attached(): boolean {
    return true;
  }

  get validWebPage(): boolean {
    return /^https?:\/\//i.test(this.currentUrl);
  }

  async attachPuppeteer(): Promise<boolean> {
    return true;
  }

  async detachPuppeteer(): Promise<void> {
    // Nothing to release: no debugger session is held.
  }

  private highlightsDrawn = false;

  /** Dialogs the page opened since the last step, reported to the model (the message is page-controlled). */
  async takeDialogNotices(): Promise<string[]> {
    const dialogs = await runInPage(this.tabId, takeRecordedDialogs, [], 'MAIN').catch(() => []);
    return dialogs.map(
      dialog =>
        `JavaScript ${dialog.type} dialog was ${dialog.accepted ? 'accepted' : 'dismissed'}. Its message:\n${wrapUntrustedContent(dialog.message)}`,
    );
  }

  async setNextDialogResponse(response: { accept: boolean; promptText?: string }): Promise<void> {
    await runInPage(this.tabId, installDialogGuard, [], 'MAIN');
    await runInPage(this.tabId, setNextDialogAnswer, [response.accept, response.promptText ?? null], 'MAIN');
  }

  getCachedState(): PageState | null {
    return this.cachedState;
  }

  async getState(useVision = false, cacheClickableElementsHashes = false): Promise<PageState> {
    await this.refreshTab();
    if (!this.validWebPage) {
      this.cachedState = build_initial_state(this.tabId, this.currentUrl, this.currentTitle);
      return this.cachedState;
    }
    const config = this.getConfig();
    const displayHighlights = config.displayHighlights || useVision;
    // Each new document needs the guard again; a blocking dialog would freeze every later script call
    await runInPage(this.tabId, installDialogGuard, [], 'MAIN').catch(error =>
      logger.debug('Could not install the dialog guard', error),
    );
    await this.removeHighlight();
    const dom = await getClickableElements(
      this.tabId,
      this.currentUrl,
      displayHighlights,
      -1,
      config.viewportExpansion,
    );
    if (displayHighlights) this.highlightsDrawn = true;
    const screenshot = useVision ? await this.takeScreenshot() : null;
    const [scrollY, visualViewportHeight, scrollHeight] = await getScrollInfo(this.tabId);
    const state: PageState = {
      ...dom,
      tabId: this.tabId,
      url: this.currentUrl,
      title: this.currentTitle,
      screenshot,
      scrollY,
      visualViewportHeight,
      scrollHeight,
    };
    if (cacheClickableElementsHashes) this.markNewElements(state);
    this.cachedState = state;
    return state;
  }

  /** Flags elements that were not clickable in the previous state of the same URL. */
  private markNewElements(state: PageState): void {
    const hashes = markNewClickableElements(state.elementTree, state.url, this.cachedHashes);
    this.cachedHashes = new CachedStateClickableElementsHashes(state.url, hashes);
  }

  async removeHighlight(): Promise<void> {
    // Vision also draws highlights, so removal follows what was drawn, not the config
    if (this.highlightsDrawn && this.validWebPage) {
      await removeHighlights(this.tabId);
      this.highlightsDrawn = false;
    }
  }

  getDomElementBySelector(
    selector: string,
    selectorMap: Map<number, DOMElementNode> = this.getSelectorMap(),
  ): DOMElementNode | null {
    const index = parseSelectorIndex(selector);
    if (index === null) return null;
    return selectorMap.get(index) || null;
  }

  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) return false;
    if (elementNode.tagName === 'input') {
      // biome-ignore lint/complexity/useLiteralKeys: attribute map is keyed by HTML names
      const type = elementNode.attributes['type'];
      if (type?.toLowerCase() === 'file' || !!elementNode.attributes['accept']) return true;
    }
    if (currentDepth >= maxDepth) return false;
    return elementNode.children.some(
      child => 'tagName' in child && this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1),
    );
  }

  async clickBySelector(_useVision: boolean, selector: string, elementNode?: DOMElementNode | null): Promise<void> {
    const outcome = await runInPage(this.tabId, clickInPage, [
      this.locatorFor(selector, elementNode),
      QAGENT_OVERLAY_HOST_ID,
    ]);
    if (!outcome.ok) throw new Error(`Failed to click "${selector}": ${outcome.error}`);
    await showAgentPointer(this.tabId, outcome.x, outcome.y);
  }

  async inputTextBySelector(
    _useVision: boolean,
    selector: string,
    text: string,
    options: { clearBeforeTyping?: boolean } = {},
  ): Promise<void> {
    const { clearBeforeTyping = true } = options;
    const outcome = await runInPage(this.tabId, writeTextInPage, [this.locatorFor(selector), text, clearBeforeTyping]);
    if (!outcome.ok) throw new Error(`Failed to type into "${selector}": ${outcome.error}`);
  }

  async sendKeys(keys: string): Promise<void> {
    const { modifiers, mainKey } = parseKeyCombination(keys);
    await runInPage(this.tabId, pressKeyInPage, [toKeyName(mainKey), toModifierNames(modifiers)]);
  }

  async scrollByDirection(direction: 'up' | 'down' | 'left' | 'right', pixels: number): Promise<void> {
    const { dx, dy } = directionDelta(direction, pixels);
    await runInPage(this.tabId, scrollByInPage, [dx, dy]);
  }

  async scrollIntoViewBySelector(selector: string): Promise<void> {
    const outcome = await runInPage(this.tabId, scrollIntoViewInPage, [this.locatorFor(selector)]);
    if (!outcome.ok) throw new Error(`Failed to scroll to "${selector}": ${outcome.error}`);
  }

  async getTextBySelector(selector: string): Promise<string> {
    const outcome = await runInPage(this.tabId, readTextInPage, [this.locatorFor(selector)]);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.text;
  }

  async getTextOf(target?: unknown): Promise<string> {
    if (target) throw new Error(`Readable targets are ${UNSUPPORTED_ON_ENGINE}; use a selector`);
    const outcome = await runInPage(this.tabId, readTextInPage, [null]);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.text;
  }

  async title(): Promise<string> {
    const tab = await chrome.tabs.get(this.tabId);
    this.currentTitle = tab.title ?? '';
    this.currentUrl = tab.url ?? this.currentUrl;
    return this.currentTitle;
  }

  url(): string {
    return this.currentUrl;
  }

  async takeScreenshot(): Promise<string | null> {
    // captureVisibleTab only sees the active tab of its window, so the tab is activated first.
    const tab = await chrome.tabs.get(this.tabId);
    if (!tab.active) await chrome.tabs.update(this.tabId, { active: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: JPEG_QUALITY });
    // The user may switch tabs between activation and capture: never hand the model another tab's pixels.
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== this.tabId) return null;
    const comma = dataUrl.indexOf(',');
    return comma === -1 ? null : dataUrl.slice(comma + 1);
  }

  async navigateTo(url: string): Promise<void> {
    await chrome.tabs.update(this.tabId, { url });
    await waitForTabComplete(this.tabId);
    await this.refreshTab();
  }

  async goBack(): Promise<void> {
    await chrome.tabs.goBack(this.tabId);
    await waitForTabComplete(this.tabId);
    await this.refreshTab();
  }

  async goForward(): Promise<void> {
    await chrome.tabs.goForward(this.tabId);
    await waitForTabComplete(this.tabId);
    await this.refreshTab();
  }

  async refreshPage(): Promise<void> {
    await chrome.tabs.reload(this.tabId);
    await waitForTabComplete(this.tabId);
    await this.refreshTab();
  }

  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
    if (elementNode) throw new Error(`Scrolling inside an element is ${UNSUPPORTED_ON_ENGINE}`);
    await runInPage(this.tabId, scrollToPercentInPage, [yPercent]);
  }

  async getElementScrollInfo(): Promise<[number, number, number]> {
    throw new Error(`Element scroll info is ${UNSUPPORTED_ON_ENGINE}`);
  }

  async scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void> {
    await this.scrollByPage(-1, elementNode);
  }

  async scrollToNextPage(elementNode?: DOMElementNode): Promise<void> {
    await this.scrollByPage(1, elementNode);
  }

  async getScrollInfo(): Promise<[number, number, number]> {
    return getScrollInfo(this.tabId);
  }

  async scrollToText(text: string, nth = 1): Promise<boolean> {
    return runInPage(this.tabId, scrollToTextInPage, [text, nth]);
  }

  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    const outcome = await runInPage(this.tabId, readSelectOptionsInPage, [this.locatorForIndex(index)]);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.options;
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    const outcome = await runInPage(this.tabId, selectOptionInPage, [this.locatorForIndex(index), text]);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.selected;
  }

  async uploadFileBySelector(
    selector: string,
    file: { name: string; content?: string; base64?: string; mimeType?: string },
  ): Promise<void> {
    const base64 = file.base64 ?? utf8ToBase64(file.content ?? '');
    const outcome = await runInPage(this.tabId, attachFileInPage, [
      this.locatorFor(selector),
      file.name,
      base64,
      file.mimeType ?? '',
    ]);
    if (!outcome.ok) throw new Error(outcome.error);
  }

  async evaluateScript(script: string): Promise<EvaluationOutcome> {
    try {
      const outcome = await withTimeout(
        runInPage(this.tabId, evaluateInPage, [script], 'MAIN'),
        JS_EVALUATION_TIMEOUT_MS,
        () => undefined,
      );
      return { ok: outcome.ok, text: truncateResult(outcome.text) };
    } catch (error) {
      return { ok: false, text: truncateResult(error instanceof Error ? error.message : String(error)) };
    }
  }

  private async scrollByPage(direction: -1 | 1, elementNode?: DOMElementNode): Promise<void> {
    if (elementNode) throw new Error(`Scrolling inside an element is ${UNSUPPORTED_ON_ENGINE}`);
    const [, viewportHeight] = await getScrollInfo(this.tabId);
    await runInPage(this.tabId, scrollByInPage, [0, direction * viewportHeight * PAGE_SCROLL_RATIO]);
  }

  /** Re-reads URL and title, after waiting for a loading page to settle. */
  private async refreshTab(): Promise<void> {
    await waitForTabComplete(this.tabId);
    const tab = await chrome.tabs.get(this.tabId);
    this.currentUrl = tab.url ?? '';
    this.currentTitle = tab.title ?? '';
  }

  private getSelectorMap(): Map<number, DOMElementNode> {
    return this.cachedState?.selectorMap ?? new Map();
  }

  private locatorForIndex(index: number): PageLocator {
    const node = this.getSelectorMap().get(index);
    if (!node) throw new Error(`Element not found for index ${index}`);
    return locatorOfNode(node);
  }

  /** Resolves a ref (@eN or [N]) to its DOM node, or treats the selector as raw XPath (xpath=) or CSS. */
  private locatorFor(selector: string, elementNode?: DOMElementNode | null): PageLocator {
    const node = elementNode ?? this.getDomElementBySelector(selector);
    if (node) return locatorOfNode(node);
    if (parseSelectorIndex(selector) !== null) throw new Error(`Element not found for selector: ${selector}`);
    if (selector.startsWith('xpath=')) return { xpath: selector.slice('xpath='.length) };
    return { css: selector };
  }
}
