export const SIDE_PANEL_CONNECTION_PORT_NAME = 'side-panel-connection' as const;

export interface SidePanelTaskCommand {
  task: string;
  taskId: string;
  tabId: number;
}

export interface BrowserFramePayload {
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

export interface BrowserStatusPayload {
  connected: boolean;
  authenticated: boolean;
  screencasting?: boolean;
  sessionId?: string;
  message?: string;
}

export type BrowserInputPayload =
  | {
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
  | {
      type: 'input_keyboard';
      sessionId?: string;
      eventType: 'keyDown' | 'keyUp' | 'char';
      key?: string;
      code?: string;
      text?: string;
      modifiers?: number;
    }
  | {
      type: 'input_touch';
      sessionId?: string;
      eventType: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
      touchPoints: Array<{ x: number; y: number; id?: number }>;
      modifiers?: number;
    };

export type SidePanelCommandMessage =
  | { type: 'heartbeat' }
  | ({ type: 'new_task' } & SidePanelTaskCommand)
  | ({ type: 'follow_up_task' } & SidePanelTaskCommand)
  | { type: 'browser_input'; input: BrowserInputPayload; sessionId?: string }
  | { type: 'cancel_task' }
  | { type: 'resume_task' }
  | { type: 'pause_task' }
  | { type: 'screenshot'; tabId: number }
  | { type: 'state' }
  | { type: 'nohighlight' }
  | { type: 'speech_to_text'; audio: string }
  | { type: 'replay'; task: string; taskId: string; tabId: number; historySessionId: string };

export interface ExecutionEventPayload {
  taskId: string;
  step: number;
  maxSteps: number;
  details: string;
}

export interface ExecutionPortEventMessage {
  type: 'execution';
  actor: string;
  state: string;
  data: ExecutionEventPayload;
  timestamp: number;
}

export interface BackgroundDebugLogMessage {
  type: 'debug_log';
  entry: {
    namespace: string;
    level: string;
    args: unknown[];
    timestamp: number;
  };
}

export type SidePanelResponseMessage =
  | ExecutionPortEventMessage
  | BackgroundDebugLogMessage
  | { type: 'browser_frame'; frame: BrowserFramePayload }
  | { type: 'browser_status'; status: BrowserStatusPayload }
  | { type: 'heartbeat_ack' }
  | { type: 'error'; error: string }
  | { type: 'success'; msg?: string; screenshot?: string | null }
  | { type: 'speech_to_text_result'; text: string }
  | { type: 'speech_to_text_error'; error: string };

export type BackgroundRuntimeMessage = { type: 'qagent:cancel' } | { type: 'qagent:overlay:state' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSidePanelCommandMessage(message: unknown): message is SidePanelCommandMessage {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return false;
  }

  switch (message.type) {
    case 'heartbeat':
    case 'cancel_task':
    case 'resume_task':
    case 'pause_task':
    case 'state':
    case 'nohighlight':
      return true;
    case 'new_task':
    case 'follow_up_task':
      return typeof message.task === 'string' && typeof message.taskId === 'string' && typeof message.tabId === 'number';
    case 'browser_input':
      return isRecord(message.input) && typeof message.input.type === 'string';
    case 'screenshot':
      return typeof message.tabId === 'number';
    case 'speech_to_text':
      return typeof message.audio === 'string';
    case 'replay':
      return (
        typeof message.task === 'string' &&
        typeof message.taskId === 'string' &&
        typeof message.tabId === 'number' &&
        typeof message.historySessionId === 'string'
      );
    default:
      return false;
  }
}

export function isSidePanelResponseMessage(message: unknown): message is SidePanelResponseMessage {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return false;
  }

  switch (message.type) {
    case 'heartbeat_ack':
      return true;
    case 'browser_frame':
      return isRecord(message.frame) && typeof message.frame.data === 'string' && isRecord(message.frame.metadata);
    case 'browser_status':
      return isRecord(message.status) && typeof message.status.connected === 'boolean';
    case 'error':
      return typeof message.error === 'string';
    case 'success':
      return (
        (message.msg === undefined || typeof message.msg === 'string') &&
        (message.screenshot === undefined || message.screenshot === null || typeof message.screenshot === 'string')
      );
    case 'speech_to_text_result':
      return typeof message.text === 'string';
    case 'speech_to_text_error':
      return typeof message.error === 'string';
    case 'debug_log':
      return isRecord(message.entry);
    case 'execution':
      return (
        typeof message.actor === 'string' &&
        typeof message.state === 'string' &&
        isRecord(message.data) &&
        typeof message.data.taskId === 'string' &&
        typeof message.data.step === 'number' &&
        typeof message.data.maxSteps === 'number' &&
        typeof message.data.details === 'string' &&
        typeof message.timestamp === 'number'
      );
    default:
      return false;
  }
}

export function isBackgroundRuntimeMessage(message: unknown): message is BackgroundRuntimeMessage {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return false;
  }
  return message.type === 'qagent:cancel' || message.type === 'qagent:overlay:state';
}
