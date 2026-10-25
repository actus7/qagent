import type { DOMElementNode } from './dom/views';
import type { BrowserContextConfig, BrowserState, PageState, TabInfo } from './views';
import type { ConsoleEntry, ConsoleReadOptions, NetworkEntry, NetworkReadOptions } from './page-telemetry';
import type { Point, Size } from './page-pointer';
import type { EvaluationOutcome } from './page-script';
import type { PageFacts, PageInfoOptions } from './page-info';
import type { ProgressReport } from './progress';
import type { TargetSpec, TargetState } from './target-resolver';
import type { ContrastFinding } from './contrast';
import type { CaptchaWidgetView } from '../services/captcha-solver';
import type { ThemeReport } from './page-visual';
import type { SiteToolDescriptor } from './site-tools';

export interface FrameSummary {
  index: number;
  url: string;
  name: string;
  crossOrigin: boolean;
  focused: boolean;
}

export interface FullPageCapture {
  base64: string;
  width: number;
  height: number;
  method: 'cdp' | 'tiles';
  truncated: boolean;
}

export interface RawChallenge {
  /** Base64 PNG of the challenge frame. */
  image: string;
  instruction: string;
  tiles: Array<{ label: number; x: number; y: number; width: number; height: number }>;
}

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
  takeDialogNotices?(): string[];
  uploadFileBySelector?(
    selector: string,
    file: { name: string; content?: string; base64?: string; mimeType?: string },
  ): Promise<void>;
  getReadabilityContent?(): Promise<{ title?: string; content: string }>;
  scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void>;
  getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]>;
  scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void>;
  getScrollInfo(): Promise<[number, number, number]>;
  scrollToNextPage(elementNode?: DOMElementNode): Promise<void>;
  scrollToText(text: string, nth?: number): Promise<boolean>;
  getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>>;
  selectDropdownOption(index: number, text: string): Promise<string>;
  // Inspection and pointer capabilities exist only on the chrome-debugger engine.
  readConsoleMessages?(options: ConsoleReadOptions): ConsoleEntry[];
  readNetworkRequests?(options: NetworkReadOptions): NetworkEntry[];
  evaluateScript?(script: string): Promise<EvaluationOutcome>;
  setViewportSize?(size: Size, mobile: boolean): Promise<void>;
  resetViewport?(): Promise<void>;
  toViewportPoint?(point: Point, fromScreenshot: boolean): Promise<Point>;
  getElementCenter?(index: number): Promise<Point>;
  clickAt?(
    point: Point,
    options: { button: 'left' | 'right' | 'middle'; clickCount: number; modifiers: string[] },
  ): Promise<void>;
  hoverAt?(point: Point): Promise<void>;
  dragBetween?(from: Point, to: Point, steps: number): Promise<void>;
  // Page structure, targets, waiting and frames. Like the pointer methods, chrome-debugger only.
  getPageFacts?(options: PageInfoOptions): Promise<PageFacts>;
  findProgressSignals?(): Promise<ProgressReport>;
  clickByTarget?(target: TargetSpec): Promise<void>;
  inputTextByTarget?(target: TargetSpec, text: string, clearBeforeTyping: boolean): Promise<void>;
  getTextOf?(target?: TargetSpec): Promise<string>;
  waitForTarget?(target: TargetSpec, state: TargetState, timeoutMs: number): Promise<number>;
  listFrames?(): Promise<FrameSummary[]>;
  focusFrame?(index: number): Promise<FrameSummary>;
  // Screenshot, WebMCP, theme, contrast, captcha and file upload. Chrome-debugger engine only.
  captureFullPage?(): Promise<FullPageCapture>;
  listSiteTools?(): Promise<{ api: string | null; tools: SiteToolDescriptor[] }>;
  callSiteTool?(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<string>;
  readTheme?(): Promise<ThemeReport>;
  auditContrast?(maxSamples: number): Promise<{ checked: number; failures: ContrastFinding[] }>;
  captchaWidgets?(): Promise<CaptchaWidgetView[]>;
  captchaSolved?(): Promise<boolean>;
  clickCaptchaCheckbox?(frameIndex: number): Promise<void>;
  captchaChallenge?(): Promise<RawChallenge | null>;
  submitCaptchaTiles?(labels: number[]): Promise<void>;
  uploadFileByPath?(selector: string, filePath: string): Promise<void>;
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
