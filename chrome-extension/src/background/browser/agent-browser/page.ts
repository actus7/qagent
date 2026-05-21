import { createLogger } from '@src/background/log';
import { isUrlAllowed } from '../util';
import type { DOMElementNode } from '../dom/views';
import type { BrowserContextConfig, PageState } from '../views';
import { URLNotAllowedError } from '../views';
import type { BrowserPageLike } from '../types';
import type { AgentBrowserCompanionClient } from './client';
import { buildPageStateFromSnapshot } from './snapshot';
import type { CompanionAction, RefMap } from './protocol';

const REF_SELECTOR_REGEX = /^@e(\d+)$/i;
const LEGACY_INDEX_SELECTOR_REGEX = /^\[(\d+)\]$/;

const logger = createLogger('AgentBrowserPage');

export interface AgentBrowserPageOptions {
  tabIdProvider: () => number;
  sessionIdProvider: () => string;
  taskIdProvider: () => string;
  getConfig: () => BrowserContextConfig;
  client: AgentBrowserCompanionClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class AgentBrowserPage implements BrowserPageLike {
  private readonly tabIdProvider: () => number;
  private readonly sessionIdProvider: () => string;
  private readonly taskIdProvider: () => string;
  private readonly getConfigFn: () => BrowserContextConfig;
  private readonly client: AgentBrowserCompanionClient;
  private state: PageState;
  private cachedState: PageState | null = null;
  private lastRefs: RefMap = {};

  constructor(options: AgentBrowserPageOptions) {
    this.tabIdProvider = options.tabIdProvider;
    this.sessionIdProvider = options.sessionIdProvider;
    this.taskIdProvider = options.taskIdProvider;
    this.getConfigFn = options.getConfig;
    this.client = options.client;
    this.state = buildPageStateFromSnapshot({
      tabId: this.tabId,
      url: 'about:blank',
      title: '',
      snapshotTree: '',
      refs: {},
      screenshot: null,
    });
  }

  get tabId(): number {
    return this.tabIdProvider();
  }

  get attached(): boolean {
    return true;
  }

  get validWebPage(): boolean {
    return true;
  }

  async attachPuppeteer(): Promise<boolean> {
    return true;
  }

  async detachPuppeteer(): Promise<void> {
    await this.close();
  }

  getCachedState(): PageState | null {
    return this.cachedState;
  }

  async getState(useVision = false): Promise<PageState> {
    void useVision;
    const snapshotResult = await this.call({
      action: 'snapshot',
      interactive: true,
      cursor: true,
      compact: true,
    });

    let screenshot: string | null = null;
    try {
      const screenshotResult = await this.call({
        action: 'screenshot',
        fullPage: false,
      });
      screenshot = screenshotResult.screenshotBase64 ?? null;
    } catch (error) {
      logger.debug('Ignoring screenshot capture failure while building browser state', error);
    }

    const nextState = buildPageStateFromSnapshot({
      tabId: this.tabId,
      url: snapshotResult.url ?? this.state.url,
      title: snapshotResult.title ?? this.state.title,
      snapshotTree: snapshotResult.snapshotTree,
      refs: snapshotResult.refs,
      screenshot,
      fallbackState: this.state,
    });

    this.state = nextState;
    this.cachedState = nextState;
    this.lastRefs = snapshotResult.refs ?? {};
    return nextState;
  }

  async removeHighlight(): Promise<void> {
    // No-op: highlights are handled by the remote browser engine.
  }

  url(): string {
    return this.state.url;
  }

  async title(): Promise<string> {
    const result = await this.call({ action: 'get', getWhat: 'title' });
    if (typeof result.title === 'string') {
      this.state.title = result.title;
    }
    if (typeof result.url === 'string') {
      this.state.url = result.url;
    }
    return this.state.title;
  }

  async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this.getConfigFn().allowedUrls, this.getConfigFn().deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }
    const result = await this.call({ action: 'open', url, waitUntil: 'domcontentloaded' });
    this.updateMeta(result);
    await this.getState(false);
  }

  async refreshPage(): Promise<void> {
    const result = await this.call({ action: 'reload', waitUntil: 'domcontentloaded' });
    this.updateMeta(result);
    await this.getState(false);
  }

  async goBack(): Promise<void> {
    const result = await this.call({ action: 'back', waitUntil: 'domcontentloaded' });
    this.updateMeta(result);
    await this.getState(false);
  }

  async goForward(): Promise<void> {
    const result = await this.call({ action: 'forward', waitUntil: 'domcontentloaded' });
    this.updateMeta(result);
    await this.getState(false);
  }

  async clickBySelector(_useVision: boolean, selector: string): Promise<void> {
    const result = await this.call({ action: 'click', selector });
    this.updateMeta(result);
  }

  async inputTextBySelector(
    _useVision: boolean,
    selector: string,
    text: string,
    options: { clearBeforeTyping?: boolean } = {},
  ): Promise<void> {
    const action: CompanionAction = options.clearBeforeTyping === false
      ? { action: 'type', selector, text }
      : { action: 'fill', selector, text };
    const result = await this.call(action);
    this.updateMeta(result);
  }

  async sendKeys(keys: string): Promise<void> {
    const result = await this.call({ action: 'press', key: keys });
    this.updateMeta(result);
  }

  async scrollByDirection(direction: 'up' | 'down' | 'left' | 'right', pixels: number): Promise<void> {
    const delta = Math.max(1, Math.abs(pixels));
    const amount = direction === 'up' || direction === 'left' ? -delta : delta;

    await this.client.sendInput({
      type: 'input_mouse',
      sessionId: this.sessionIdProvider(),
      eventType: 'mouseWheel',
      x: 0,
      y: 0,
      deltaX: direction === 'left' || direction === 'right' ? amount : 0,
      deltaY: direction === 'up' || direction === 'down' ? amount : 0,
    });
    await sleep(150);
  }

  async scrollIntoViewBySelector(selector: string): Promise<void> {
    // Best effort in V1: wait for element before interacting.
    await this.call({
      action: 'wait',
      selector,
      timeoutMs: 10_000,
    });
  }

  async getTextBySelector(selector: string): Promise<string> {
    const result = await this.call({ action: 'get', getWhat: 'text', selector });
    return result.text ?? '';
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
    const result = await this.call({ action: 'screenshot', fullPage });
    return result.screenshotBase64 ?? null;
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

  isFileUploader(elementNode: DOMElementNode): boolean {
    void elementNode;
    return false;
  }

  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
    void yPercent;
    void elementNode;
    throw new Error('scroll_to_percent is not supported in agent-browser V1 mode');
  }

  async getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]> {
    void elementNode;
    throw new Error('get_element_scroll_info is not supported in agent-browser V1 mode');
  }

  async scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void> {
    void elementNode;
    throw new Error('previous_page is not supported in agent-browser V1 mode');
  }

  async getScrollInfo(): Promise<[number, number, number]> {
    return [this.state.scrollY, this.state.visualViewportHeight, this.state.scrollHeight];
  }

  async scrollToNextPage(elementNode?: DOMElementNode): Promise<void> {
    void elementNode;
    throw new Error('next_page is not supported in agent-browser V1 mode');
  }

  async scrollToText(text: string, nth = 1): Promise<boolean> {
    void text;
    void nth;
    throw new Error('scroll_to_text is not supported in agent-browser V1 mode');
  }

  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    void index;
    throw new Error('get_dropdown_options is not supported in agent-browser V1 mode');
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    void index;
    void text;
    throw new Error('select_dropdown_option is not supported in agent-browser V1 mode');
  }

  async getReadabilityContent(): Promise<{ title?: string; content: string }> {
    const result = await this.call({
      action: 'snapshot',
      interactive: false,
      cursor: false,
      compact: false,
    });
    return {
      title: result.title ?? this.state.title,
      content: result.html ?? result.snapshotTree ?? '',
    };
  }

  async close(): Promise<void> {
    try {
      await this.call({ action: 'close' });
    } catch (error) {
      logger.debug('Ignoring close error in agent-browser page cleanup', error);
    }
    this.cachedState = null;
  }

  private getSelectorMap(): Map<number, DOMElementNode> {
    return this.cachedState?.selectorMap ?? new Map();
  }

  private selectorToIndex(selector: string): number | null {
    const trimmedSelector = selector.trim();
    const refMatch = REF_SELECTOR_REGEX.exec(trimmedSelector);
    if (refMatch) {
      return Number.parseInt(refMatch[1], 10);
    }

    const legacyIndexMatch = LEGACY_INDEX_SELECTOR_REGEX.exec(trimmedSelector);
    if (legacyIndexMatch) {
      return Number.parseInt(legacyIndexMatch[1], 10);
    }

    return null;
  }

  private async call(action: CompanionAction) {
    const sessionId = this.sessionIdProvider();
    const taskId = this.taskIdProvider();
    const response = await this.client.request(sessionId, taskId, action);
    if (!response.success) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  private updateMeta(result: { url?: string; title?: string }): void {
    if (result.url) {
      this.state.url = result.url;
    }
    if (result.title) {
      this.state.title = result.title;
    }
  }
}
