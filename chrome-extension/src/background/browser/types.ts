import type { DOMElementNode } from './dom/views';
import type { BrowserContextConfig, BrowserState, PageState, TabInfo } from './views';

export type BrowserEngineName = 'chrome-debugger' | 'agent-browser-v1';

export interface BrowserPageLike {
  tabId: number;
  attached: boolean;
  validWebPage: boolean;
  attachPuppeteer(): Promise<boolean>;
  detachPuppeteer(): Promise<void>;
  getCachedState(): PageState | null;
  getState(useVision?: boolean, cacheClickableElementsHashes?: boolean): Promise<PageState>;
  navigateTo(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  refreshPage(): Promise<void>;
  getDomElementBySelector(selector: string, selectorMap?: Map<number, DOMElementNode>): DOMElementNode | null;
  isFileUploader(elementNode: DOMElementNode, maxDepth?: number, currentDepth?: number): boolean;
  clickBySelector(useVision: boolean, selector: string, elementNode?: DOMElementNode | null): Promise<void>;
  inputTextBySelector(
    useVision: boolean,
    selector: string,
    text: string,
    options?: { clearBeforeTyping?: boolean },
  ): Promise<void>;
  sendKeys(keys: string): Promise<void>;
  scrollByDirection(direction: 'up' | 'down' | 'left' | 'right', pixels: number): Promise<void>;
  scrollIntoViewBySelector(selector: string): Promise<void>;
  getTextBySelector(selector: string): Promise<string>;
  title(): Promise<string>;
  url(): string;
  takeScreenshot(fullPage?: boolean): Promise<string | null>;
  removeHighlight(): Promise<void>;
  getReadabilityContent?(): Promise<{ title?: string; content: string }>;
  scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void>;
  getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]>;
  scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void>;
  getScrollInfo(): Promise<[number, number, number]>;
  scrollToNextPage(elementNode?: DOMElementNode): Promise<void>;
  scrollToText(text: string, nth?: number): Promise<boolean>;
  getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>>;
  selectDropdownOption(index: number, text: string): Promise<string>;
}

export interface BrowserContextLike {
  readonly currentTabId: number | null;
  getEngineName(): BrowserEngineName;
  getConfig(): BrowserContextConfig;
  updateConfig(config: Partial<BrowserContextConfig>): void;
  updateCurrentTabId(tabId: number): void;
  cleanup(): Promise<void>;
  attachPage(page: BrowserPageLike): Promise<boolean>;
  detachPage(tabId: number): Promise<void>;
  removeAttachedPage(tabId: number): void;
  getCurrentPage(): Promise<BrowserPageLike>;
  getAllTabIds(): Promise<Set<number>>;
  switchTab(tabId: number): Promise<BrowserPageLike>;
  navigateTo(url: string): Promise<void>;
  openTab(url: string): Promise<BrowserPageLike>;
  closeTab(tabId: number): Promise<void>;
  getTabInfos(): Promise<TabInfo[]>;
  getCachedState(useVision?: boolean, cacheClickableElementsHashes?: boolean): Promise<BrowserState>;
  getState(useVision?: boolean, cacheClickableElementsHashes?: boolean): Promise<BrowserState>;
  removeHighlight(): Promise<void>;
}
