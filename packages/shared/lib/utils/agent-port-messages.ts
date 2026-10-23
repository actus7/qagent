import type { AssistantAttachment } from './assistant-attachments';
import { isValidAssistantAttachments } from './assistant-attachments';

export const SIDE_PANEL_CONNECTION_PORT_NAME = 'side-panel-connection' as const;

export type AssistantMode = 'chat' | 'plan' | 'act';
export type PermissionMode = 'ask' | 'auto' | 'plan';

// once: allow this request only. always_site: allow this request and persist the origin. deny: refuse.
export type ApprovalDecision = 'once' | 'always_site' | 'deny';

export interface AssistantTaskOptions {
  mode?: AssistantMode;
  permissionMode?: PermissionMode;
  tabIds?: number[];
  modelAgent?: 'navigator' | 'planner';
}

export interface ActionApproval {
  id: string;
  taskId: string;
  action: string;
  description: string;
  parameters?: string;
  tabId: number | null;
  url: string;
  // 'plan' requests approve the whole plan (domains) before the first action of a plan-mode task.
  kind?: 'action' | 'plan';
  // Sensitive actions always ask, and never offer "always allow this site".
  sensitive?: boolean;
  sensitiveReasons?: string[];
  // Set when a navigation leaves the registrable domain of the current page.
  transition?: { from: string; to: string };
  // Domains covered by a plan approval request.
  domains?: string[];
  allowSiteOption?: boolean;
  // Destination URL for navigation approvals; the "always allow" choice persists its origin.
  targetUrl?: string;
}

export interface SidePanelTaskCommand {
  task: string;
  taskId: string;
  tabId: number;
  options?: AssistantTaskOptions;
  /** Images (sent to the model) and binary files (uploaded by upload_file) attached in the composer. */
  attachments?: AssistantAttachment[];
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
  | { type: 'approval_result'; taskId: string; requestId: string; approved: boolean; decision?: ApprovalDecision }
  | { type: 'screenshot'; tabId: number }
  | { type: 'capture_visible_tab'; tabId: number }
  | { type: 'state' }
  | { type: 'nohighlight' }
  | { type: 'compact_chat'; taskId: string; modelAgent?: 'navigator' | 'planner' }
  | { type: 'speech_to_text'; audio: string }
  | { type: 'replay'; task: string; taskId: string; tabId: number; historySessionId: string };

interface ExecutionEventPayload {
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

interface BackgroundDebugLogMessage {
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
  | { type: 'assistant_delta'; taskId: string; streamId: string; content: string; finished: boolean }
  | { type: 'approval_required'; request: ActionApproval }
  | { type: 'approval_resolved'; requestId: string }
  | { type: 'browser_frame'; frame: BrowserFramePayload }
  | { type: 'browser_status'; status: BrowserStatusPayload }
  | { type: 'heartbeat_ack' }
  | { type: 'error'; error: string }
  | { type: 'success'; msg?: string; screenshot?: string | null }
  | { type: 'tab_capture'; dataUrl: string }
  | { type: 'speech_to_text_result'; text: string }
  | { type: 'conversation_compacted'; taskId: string; compacted: boolean }
  | { type: 'speech_to_text_error'; error: string };

type BackgroundRuntimeMessage =
  | { type: 'qagent:cancel' }
  | { type: 'qagent:overlay:state' }
  | { type: 'qagent:test-provider'; providerId: string }
  | { type: 'qagent:schedule:run-now'; id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasAttachments(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isOptionalAttachments(value: unknown): boolean {
  return value === undefined || isValidAssistantAttachments(value);
}

function isTaskOptions(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    (value.mode === undefined || ['chat', 'plan', 'act'].includes(String(value.mode))) &&
    (value.permissionMode === undefined || ['ask', 'auto', 'plan'].includes(String(value.permissionMode))) &&
    (value.modelAgent === undefined || ['navigator', 'planner'].includes(String(value.modelAgent))) &&
    (value.tabIds === undefined ||
      (Array.isArray(value.tabIds) &&
        value.tabIds.length <= 12 &&
        value.tabIds.every(id => Number.isSafeInteger(id) && id >= 0)))
  );
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
    case 'compact_chat':
      return (
        typeof message.taskId === 'string' &&
        message.taskId.length > 0 &&
        (message.modelAgent === undefined || message.modelAgent === 'navigator' || message.modelAgent === 'planner')
      );
    case 'new_task':
    case 'follow_up_task':
      return (
        typeof message.task === 'string' &&
        (message.task.trim().length > 0 || hasAttachments(message.attachments)) &&
        typeof message.taskId === 'string' &&
        message.taskId.length > 0 &&
        Number.isSafeInteger(message.tabId) &&
        Number(message.tabId) >= 0 &&
        isTaskOptions(message.options) &&
        isOptionalAttachments(message.attachments)
      );
    case 'approval_result':
      return (
        typeof message.taskId === 'string' &&
        typeof message.requestId === 'string' &&
        typeof message.approved === 'boolean' &&
        (message.decision === undefined || ['once', 'always_site', 'deny'].includes(String(message.decision)))
      );
    case 'browser_input':
      return isRecord(message.input) && typeof message.input.type === 'string';
    case 'screenshot':
      return typeof message.tabId === 'number';
    case 'capture_visible_tab':
      return Number.isSafeInteger(message.tabId) && Number(message.tabId) >= 0;
    case 'speech_to_text':
      return typeof message.audio === 'string';
    case 'replay':
      return (
        typeof message.task === 'string' &&
        typeof message.taskId === 'string' &&
        typeof message.tabId === 'number' &&
        typeof message.historySessionId === 'string' &&
        isOptionalAttachments(message.attachments)
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
    case 'assistant_delta':
      return (
        typeof message.taskId === 'string' &&
        typeof message.streamId === 'string' &&
        typeof message.content === 'string' &&
        typeof message.finished === 'boolean'
      );
    case 'approval_required':
      return (
        isRecord(message.request) &&
        typeof message.request.id === 'string' &&
        typeof message.request.taskId === 'string' &&
        typeof message.request.action === 'string' &&
        typeof message.request.description === 'string' &&
        typeof message.request.url === 'string'
      );
    case 'approval_resolved':
      return typeof message.requestId === 'string';
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
    case 'tab_capture':
      return typeof message.dataUrl === 'string' && message.dataUrl.startsWith('data:image/png;base64,');
    case 'speech_to_text_result':
      return typeof message.text === 'string';
    case 'conversation_compacted':
      return typeof message.taskId === 'string' && typeof message.compacted === 'boolean';
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
  if (message.type === 'qagent:test-provider') {
    return typeof message.providerId === 'string' && message.providerId.length > 0 && message.providerId.length <= 200;
  }
  if (message.type === 'qagent:schedule:run-now') {
    return typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 100;
  }
  return message.type === 'qagent:cancel' || message.type === 'qagent:overlay:state';
}
