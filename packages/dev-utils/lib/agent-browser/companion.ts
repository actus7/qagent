import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { BrowserManagerLaunchOptions } from './session-manager';
import { BrowserSessionManager } from './session-manager';
import { createBrowserTool } from './tool';
import type { BrowserToolInput, BrowserToolResult } from './types';

export interface CompanionServerOptions {
  host?: string;
  port?: number;
  token?: string;
  sessionTimeoutMs?: number;
  headless?: boolean;
  profile?: string;
  launch?: BrowserManagerLaunchOptions;
  allowedUrls?: string[];
  deniedUrls?: string[];
}

interface ConnectionState {
  authenticated: boolean;
  activeSessionId: string | null;
}

interface RpcRequestMessage {
  type: 'rpc_request';
  id: string;
  sessionId: string;
  taskId: string;
  action: Record<string, unknown>;
}

interface HelloMessage {
  type: 'hello';
  token: string;
}

interface MouseInputMessage {
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

interface KeyboardInputMessage {
  type: 'input_keyboard';
  sessionId?: string;
  eventType: 'keyDown' | 'keyUp' | 'char';
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

interface TouchInputMessage {
  type: 'input_touch';
  sessionId?: string;
  eventType: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
  touchPoints: Array<{ x: number; y: number; id?: number }>;
  modifiers?: number;
}

type InputMessage = MouseInputMessage | KeyboardInputMessage | TouchInputMessage;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9223;
const DEFAULT_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJson(raw: RawData): unknown {
  return JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
}

function parseCsvEnv(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function normalizeHostname(input: string): string {
  const normalized = input.trim().toLowerCase();
  return normalized.replace(/^www\./, '');
}

function domainMatches(urlHostname: string, rule: string): boolean {
  const normalizedRule = normalizeHostname(rule);
  const normalizedHost = normalizeHostname(urlHostname);
  if (!normalizedRule) {
    return false;
  }
  if (normalizedRule === normalizedHost) {
    return true;
  }
  return normalizedHost.endsWith(`.${normalizedRule}`);
}

function isUrlAllowed(url: string, allowList: string[], denyList: string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  const denied = denyList.some(rule => domainMatches(hostname, rule));
  if (denied) {
    return false;
  }

  if (allowList.length === 0) {
    return true;
  }

  return allowList.some(rule => domainMatches(hostname, rule));
}

function isHelloMessage(value: unknown): value is HelloMessage {
  return isObject(value) && value.type === 'hello' && typeof value.token === 'string';
}

function isRpcMessage(value: unknown): value is RpcRequestMessage {
  return (
    isObject(value) &&
    value.type === 'rpc_request' &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.taskId === 'string' &&
    isObject(value.action)
  );
}

function isMouseInputMessage(value: unknown): value is MouseInputMessage {
  return (
    isObject(value) &&
    value.type === 'input_mouse' &&
    typeof value.eventType === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number'
  );
}

function isKeyboardInputMessage(value: unknown): value is KeyboardInputMessage {
  return isObject(value) && value.type === 'input_keyboard' && typeof value.eventType === 'string';
}

function isTouchInputMessage(value: unknown): value is TouchInputMessage {
  return isObject(value) && value.type === 'input_touch' && Array.isArray(value.touchPoints);
}

function isInputMessage(value: unknown): value is InputMessage {
  return isMouseInputMessage(value) || isKeyboardInputMessage(value) || isTouchInputMessage(value);
}

function buildError(code: string, message: string, details?: unknown) {
  return { code, message, details };
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export class AgentBrowserCompanionServer {
  private readonly host: string;
  private readonly port: number;
  private readonly token?: string;
  private readonly allowedUrls: string[];
  private readonly deniedUrls: string[];
  private readonly manager: BrowserSessionManager;
  private readonly tool: ReturnType<typeof createBrowserTool>;
  private wss: WebSocketServer | null = null;
  private readonly connectionState = new WeakMap<WebSocket, ConnectionState>();
  private readonly streamSubscribers = new Map<string, Set<WebSocket>>();

  constructor(options: CompanionServerOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.token = options.token;
    this.allowedUrls = options.allowedUrls ?? [];
    this.deniedUrls = options.deniedUrls ?? [];

    this.manager = new BrowserSessionManager({
      sessionTimeoutMs: options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
      launch: options.launch ?? {
        headless: options.headless ?? true,
        ...(options.profile ? { profile: options.profile } : {}),
      },
      onScreencastFrame: (sessionId, frame) => {
        this.broadcastFrame(sessionId, frame);
      },
    });

    this.tool = createBrowserTool(this.manager);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AgentBrowserCompanionServer {
    const host = env.AGENT_BROWSER_WS_HOST ?? DEFAULT_HOST;
    const port = Number.parseInt(env.AGENT_BROWSER_WS_PORT ?? String(DEFAULT_PORT), 10);
    const headless = env.AGENT_BROWSER_HEADLESS ? env.AGENT_BROWSER_HEADLESS === 'true' : true;
    const token = env.AGENT_BROWSER_WS_TOKEN?.trim() || undefined;
    const sessionTimeoutMs = Number.parseInt(
      env.AGENT_BROWSER_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS),
      10,
    );
    const allowedUrls = parseCsvEnv(env.AGENT_BROWSER_ALLOWED_URLS);
    const deniedUrls = parseCsvEnv(env.AGENT_BROWSER_DENIED_URLS);
    const profile = env.AGENT_BROWSER_PROFILE?.trim() || undefined;

    return new AgentBrowserCompanionServer({
      host,
      port: Number.isFinite(port) ? port : DEFAULT_PORT,
      headless,
      token,
      sessionTimeoutMs: Number.isFinite(sessionTimeoutMs) ? sessionTimeoutMs : DEFAULT_SESSION_TIMEOUT_MS,
      allowedUrls,
      deniedUrls,
      profile,
    });
  }

  async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    this.wss = new WebSocketServer({
      host: this.host,
      port: this.port,
    });

    this.wss.on('connection', ws => {
      this.handleConnection(ws);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.wss) {
        reject(new Error('WebSocket server not initialized'));
        return;
      }
      this.wss.once('listening', () => resolve());
      this.wss.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) {
      return;
    }

    for (const sessionId of this.streamSubscribers.keys()) {
      try {
        await this.manager.stopScreencast(sessionId);
      } catch {
        // Ignore teardown errors.
      }
    }
    this.streamSubscribers.clear();

    await this.manager.closeAll();

    await new Promise<void>((resolve, reject) => {
      this.wss?.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.wss = null;
  }

  getAddress(): string {
    return `ws://${this.host}:${this.port}`;
  }

  private handleConnection(ws: WebSocket): void {
    const state: ConnectionState = {
      authenticated: !this.token,
      activeSessionId: null,
    };
    this.connectionState.set(ws, state);

    sendJson(ws, {
      type: 'status',
      connected: true,
      authenticated: state.authenticated,
      screencasting: false,
    });

    ws.on('message', async raw => {
      let message: unknown;
      try {
        message = parseJson(raw);
      } catch {
        sendJson(ws, {
          type: 'error',
          error: buildError('INVALID_JSON', 'Failed to parse incoming JSON message'),
        });
        return;
      }

      if (isHelloMessage(message)) {
        if (!this.token || message.token === this.token) {
          state.authenticated = true;
          sendJson(ws, {
            type: 'status',
            connected: true,
            authenticated: true,
            screencasting: false,
          });
        } else {
          sendJson(ws, {
            type: 'status',
            connected: true,
            authenticated: false,
            message: 'Invalid token',
          });
        }
        return;
      }

      if (!state.authenticated) {
        sendJson(ws, {
          type: 'error',
          error: buildError('UNAUTHENTICATED', 'Send hello token before issuing commands'),
        });
        return;
      }

      if (isInputMessage(message)) {
        await this.handleInputMessage(ws, state, message);
        return;
      }

      if (isRpcMessage(message)) {
        state.activeSessionId = message.sessionId;
        await this.handleRpcMessage(ws, state, message);
        return;
      }

      sendJson(ws, {
        type: 'error',
        error: buildError('UNSUPPORTED_MESSAGE', 'Unsupported websocket message'),
      });
    });

    ws.on('close', () => {
      this.removeSocketFromStreams(ws);
      this.connectionState.delete(ws);
    });
  }

  private async handleInputMessage(ws: WebSocket, state: ConnectionState, message: InputMessage): Promise<void> {
    const sessionId = asString(message.sessionId) ?? state.activeSessionId;
    if (!sessionId) {
      sendJson(ws, {
        type: 'error',
        error: buildError('SESSION_REQUIRED', 'Input event requires sessionId or an active rpc session'),
      });
      return;
    }

    try {
      if (message.type === 'input_mouse') {
        await this.manager.injectMouseEvent(sessionId, {
          type: message.eventType,
          x: message.x,
          y: message.y,
          button: message.button ?? 'left',
          clickCount: message.clickCount,
          deltaX: message.deltaX,
          deltaY: message.deltaY,
          modifiers: message.modifiers,
        });
      } else if (message.type === 'input_keyboard') {
        await this.manager.injectKeyboardEvent(sessionId, {
          type: message.eventType,
          key: message.key,
          code: message.code,
          text: message.text,
          modifiers: message.modifiers,
        });
      } else {
        await this.manager.injectTouchEvent(sessionId, {
          type: message.eventType,
          touchPoints: message.touchPoints,
          modifiers: message.modifiers,
        });
      }
    } catch (error) {
      sendJson(ws, {
        type: 'error',
        error: buildError(
          'INPUT_EVENT_FAILED',
          error instanceof Error ? error.message : 'Failed to inject input event',
        ),
      });
    }
  }

  private async handleRpcMessage(ws: WebSocket, state: ConnectionState, message: RpcRequestMessage): Promise<void> {
    const normalizedInput = this.normalizeToolInput(message);
    if (!normalizedInput) {
      sendJson(ws, {
        type: 'rpc_response',
        id: message.id,
        success: false,
        error: buildError('INVALID_ACTION', 'Invalid or unsupported action payload'),
      });
      return;
    }

    if (normalizedInput.action === 'open' && normalizedInput.url) {
      if (!isUrlAllowed(normalizedInput.url, this.allowedUrls, this.deniedUrls)) {
        sendJson(ws, {
          type: 'rpc_response',
          id: message.id,
          success: false,
          error: buildError('URL_BLOCKED', `URL is not allowed: ${normalizedInput.url}`),
        });
        return;
      }
    }

    try {
      if (normalizedInput.action === 'start_screencast') {
        this.addStreamSubscriber(normalizedInput.sessionId, ws);
      } else if (normalizedInput.action === 'stop_screencast') {
        const remaining = this.removeStreamSubscriber(normalizedInput.sessionId, ws);
        if (remaining > 0) {
          sendJson(ws, {
            type: 'rpc_response',
            id: message.id,
            success: true,
            data: {
              success: true,
              sessionId: normalizedInput.sessionId,
              action: normalizedInput.action,
            },
          });
          sendJson(ws, {
            type: 'status',
            connected: true,
            authenticated: true,
            sessionId: normalizedInput.sessionId,
            screencasting: true,
          });
          return;
        }
      }

      const result = await this.tool(normalizedInput);
      sendJson(ws, this.toRpcResponse(message.id, result));

      if (normalizedInput.action === 'start_screencast' || normalizedInput.action === 'stop_screencast') {
        const screencasting = await this.manager.isScreencasting(normalizedInput.sessionId);
        sendJson(ws, {
          type: 'status',
          connected: true,
          authenticated: true,
          sessionId: normalizedInput.sessionId,
          screencasting,
        });
      }

      state.activeSessionId = normalizedInput.sessionId;
    } catch (error) {
      sendJson(ws, {
        type: 'rpc_response',
        id: message.id,
        success: false,
        error: buildError('BROWSER_ERROR', error instanceof Error ? error.message : 'Unknown browser error'),
      });
    }
  }

  private toRpcResponse(id: string, result: BrowserToolResult) {
    if (result.success) {
      return {
        type: 'rpc_response',
        id,
        success: true,
        data: result,
      };
    }
    return {
      type: 'rpc_response',
      id,
      success: false,
      error: buildError('BROWSER_ERROR', result.error ?? 'Unknown browser error'),
    };
  }

  private normalizeToolInput(message: RpcRequestMessage): BrowserToolInput | null {
    const actionName = asString(message.action.action);
    if (!actionName) {
      return null;
    }

    const input: BrowserToolInput = {
      sessionId: message.sessionId,
      action: actionName as BrowserToolInput['action'],
    };

    const maybeAssignString = <K extends keyof BrowserToolInput>(field: K, value: unknown) => {
      const parsed = asString(value);
      if (parsed !== null) {
        (input[field] as unknown) = parsed;
      }
    };

    const maybeAssignNumber = <K extends keyof BrowserToolInput>(field: K, value: unknown) => {
      const parsed = asNumber(value);
      if (parsed !== null) {
        (input[field] as unknown) = parsed;
      }
    };

    maybeAssignString('url', message.action.url);
    maybeAssignString('selector', message.action.selector ?? message.action.target);
    maybeAssignString('text', message.action.text);
    maybeAssignString('key', message.action.key);
    maybeAssignString('waitText', message.action.waitText ?? message.action.text);
    maybeAssignString('waitUrl', message.action.waitUrl ?? message.action.url);
    maybeAssignString('scopeSelector', message.action.scopeSelector ?? message.action.selector);
    maybeAssignString('screenshotPath', message.action.screenshotPath);
    maybeAssignNumber('maxDepth', message.action.maxDepth ?? message.action.depth);
    maybeAssignNumber('waitMs', message.action.waitMs ?? message.action.ms);
    maybeAssignNumber('timeoutMs', message.action.timeoutMs);
    maybeAssignNumber('tabIndex', message.action.tabIndex);
    maybeAssignNumber('screencastQuality', message.action.screencastQuality);
    maybeAssignNumber('screencastMaxWidth', message.action.screencastMaxWidth);
    maybeAssignNumber('screencastMaxHeight', message.action.screencastMaxHeight);
    maybeAssignNumber('screencastEveryNthFrame', message.action.screencastEveryNthFrame);

    if (typeof message.action.interactive === 'boolean') {
      input.interactive = message.action.interactive;
    }
    if (typeof message.action.cursor === 'boolean') {
      input.cursor = message.action.cursor;
    }
    if (typeof message.action.compact === 'boolean') {
      input.compact = message.action.compact;
    }
    if (typeof message.action.includeHtml === 'boolean') {
      input.includeHtml = message.action.includeHtml;
    }
    if (typeof message.action.fullPage === 'boolean') {
      input.fullPage = message.action.fullPage;
    }
    if (typeof message.action.waitUntil === 'string') {
      input.waitUntil = message.action.waitUntil as BrowserToolInput['waitUntil'];
    }
    if (typeof message.action.waitLoadState === 'string') {
      input.waitLoadState = message.action.waitLoadState as BrowserToolInput['waitLoadState'];
    }
    if (typeof message.action.screencastFormat === 'string') {
      input.screencastFormat = message.action.screencastFormat as BrowserToolInput['screencastFormat'];
    }
    if (typeof message.action.getWhat === 'string') {
      input.getWhat = message.action.getWhat as BrowserToolInput['getWhat'];
    } else if (typeof message.action.what === 'string') {
      input.getWhat = message.action.what as BrowserToolInput['getWhat'];
    }

    if (Array.isArray(message.action.filePaths)) {
      input.filePaths = message.action.filePaths.filter((value): value is string => typeof value === 'string');
    } else if (Array.isArray(message.action.paths)) {
      input.filePaths = message.action.paths.filter((value): value is string => typeof value === 'string');
    }

    switch (input.action) {
      case 'open':
      case 'snapshot':
      case 'click':
      case 'type':
      case 'fill':
      case 'press':
      case 'wait':
      case 'get':
      case 'upload':
      case 'back':
      case 'forward':
      case 'reload':
      case 'screenshot':
      case 'tab_list':
      case 'tab_new':
      case 'tab_switch':
      case 'tab_close':
      case 'start_screencast':
      case 'stop_screencast':
      case 'close':
      case 'get_text':
      case 'get_title':
      case 'get_url':
        return input;
      default:
        return null;
    }
  }

  private addStreamSubscriber(sessionId: string, ws: WebSocket): void {
    let subscribers = this.streamSubscribers.get(sessionId);
    if (!subscribers) {
      subscribers = new Set();
      this.streamSubscribers.set(sessionId, subscribers);
    }
    subscribers.add(ws);
  }

  private removeStreamSubscriber(sessionId: string, ws: WebSocket): number {
    const subscribers = this.streamSubscribers.get(sessionId);
    if (!subscribers) {
      return 0;
    }
    subscribers.delete(ws);
    if (subscribers.size === 0) {
      this.streamSubscribers.delete(sessionId);
      void this.manager.stopScreencast(sessionId).catch(() => {});
      return 0;
    }
    return subscribers.size;
  }

  private removeSocketFromStreams(ws: WebSocket): void {
    for (const [sessionId, subscribers] of this.streamSubscribers.entries()) {
      if (!subscribers.has(ws)) {
        continue;
      }
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.streamSubscribers.delete(sessionId);
        void this.manager.stopScreencast(sessionId).catch(() => {});
      }
    }
  }

  private broadcastFrame(
    sessionId: string,
    frame: {
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
    },
  ): void {
    const subscribers = this.streamSubscribers.get(sessionId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = {
      type: 'frame',
      sessionId,
      data: frame.data,
      metadata: frame.metadata,
    };

    for (const ws of subscribers) {
      sendJson(ws, payload);
    }
  }
}
