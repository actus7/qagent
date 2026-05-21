import type { RefMap } from 'agent-browser/dist/snapshot.js';

export type BrowserToolAction =
  | 'open'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'fill'
  | 'press'
  | 'wait'
  | 'get'
  | 'upload'
  | 'back'
  | 'forward'
  | 'reload'
  | 'get_text'
  | 'get_title'
  | 'get_url'
  | 'screenshot'
  | 'tab_list'
  | 'tab_new'
  | 'tab_switch'
  | 'tab_close'
  | 'start_screencast'
  | 'stop_screencast'
  | 'close';

export interface BrowserToolInput {
  sessionId: string;
  action: BrowserToolAction;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  getWhat?: 'text' | 'title' | 'url' | 'value';
  waitMs?: number;
  waitText?: string;
  waitUrl?: string;
  waitLoadState?: 'load' | 'domcontentloaded' | 'networkidle';
  timeoutMs?: number;
  filePaths?: string[];
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  interactive?: boolean;
  cursor?: boolean;
  compact?: boolean;
  maxDepth?: number;
  scopeSelector?: string;
  includeHtml?: boolean;
  screenshotPath?: string;
  fullPage?: boolean;
  tabIndex?: number;
  screencastFormat?: 'jpeg' | 'png';
  screencastQuality?: number;
  screencastMaxWidth?: number;
  screencastMaxHeight?: number;
  screencastEveryNthFrame?: number;
}

export interface BrowserToolResult {
  success: boolean;
  sessionId: string;
  action: BrowserToolAction;
  url?: string;
  title?: string;
  text?: string;
  html?: string;
  snapshotTree?: string;
  refs?: RefMap;
  screenshotPath?: string;
  screenshotBase64?: string;
  tabs?: Array<{
    index: number;
    url: string;
    title: string;
    active: boolean;
  }>;
  error?: string;
}
