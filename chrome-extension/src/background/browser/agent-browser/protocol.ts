export interface RefMap {
  [ref: string]: {
    selector: string;
    role: string;
    name?: string;
    nth?: number;
  };
}

export type CompanionLoadState = 'load' | 'domcontentloaded' | 'networkidle';

export type CompanionAction =
  | { action: 'open'; url: string; waitUntil?: CompanionLoadState }
  | {
      action: 'snapshot';
      interactive?: boolean;
      cursor?: boolean;
      compact?: boolean;
      maxDepth?: number;
      scopeSelector?: string;
      includeHtml?: boolean;
    }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; text: string }
  | { action: 'type'; selector: string; text: string }
  | { action: 'press'; key: string }
  | { action: 'back'; waitUntil?: CompanionLoadState }
  | { action: 'forward'; waitUntil?: CompanionLoadState }
  | { action: 'reload'; waitUntil?: CompanionLoadState }
  | {
      action: 'wait';
      waitMs?: number;
      selector?: string;
      waitText?: string;
      waitUrl?: string;
      waitLoadState?: CompanionLoadState;
      timeoutMs?: number;
    }
  | { action: 'get'; getWhat: 'text' | 'title' | 'url' | 'value'; selector?: string }
  | { action: 'screenshot'; fullPage?: boolean; screenshotPath?: string }
  | { action: 'upload'; selector: string; filePaths: string[] }
  | { action: 'tab_list' }
  | { action: 'tab_new'; url?: string; waitUntil?: CompanionLoadState }
  | { action: 'tab_switch'; tabIndex: number }
  | { action: 'tab_close'; tabIndex?: number }
  | {
      action: 'start_screencast';
      screencastFormat?: 'jpeg' | 'png';
      screencastQuality?: number;
      screencastMaxWidth?: number;
      screencastMaxHeight?: number;
      screencastEveryNthFrame?: number;
    }
  | { action: 'stop_screencast' }
  | { action: 'close' };

export interface CompanionRpcRequest {
  type: 'rpc_request';
  id: string;
  sessionId: string;
  taskId: string;
  action: CompanionAction;
}

export interface CompanionRpcSuccess {
  type: 'rpc_response';
  id: string;
  success: true;
  data: {
    success: boolean;
    sessionId: string;
    action: string;
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
  };
}

export interface CompanionRpcFailure {
  type: 'rpc_response';
  id: string;
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type CompanionRpcResponse = CompanionRpcSuccess | CompanionRpcFailure;

export interface CompanionFrameMessage {
  type: 'frame';
  sessionId: string;
  data: string;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
}

export interface CompanionStatusMessage {
  type: 'status';
  connected: boolean;
  authenticated: boolean;
  screencasting?: boolean;
  sessionId?: string;
  message?: string;
}

export interface CompanionHelloMessage {
  type: 'hello';
  token: string;
}

export interface CompanionMouseInputMessage {
  type: 'input_mouse';
  sessionId?: string;
  eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'left' | 'middle' | 'right';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

export interface CompanionKeyboardInputMessage {
  type: 'input_keyboard';
  sessionId?: string;
  eventType: 'keyDown' | 'keyUp' | 'char';
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

export interface CompanionTouchInputMessage {
  type: 'input_touch';
  sessionId?: string;
  eventType: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
  touchPoints: Array<{ x: number; y: number; id?: number }>;
  modifiers?: number;
}

export type CompanionInputMessage = CompanionMouseInputMessage | CompanionKeyboardInputMessage | CompanionTouchInputMessage;

export type CompanionInboundMessage = CompanionRpcResponse | CompanionFrameMessage | CompanionStatusMessage;
