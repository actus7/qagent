import { t } from '@extension/i18n';
import {
  MCP_BRIDGE_HANDSHAKE_TIMEOUT_MS,
  type McpBridgeEventFrame,
  type McpBridgeHostMethod,
  type McpBridgeResponseFrame,
} from '@extension/shared';
import { isValidMcpBridgeToken, mcpBridgeStore, type McpBridgeConfig } from '@extension/storage';
import { createLogger } from '../../log';
import { handleBridgeRequest, toBridgeResponse } from './handlers';
import { BridgeHandshake } from './handshake';
import { extractRequestId, McpBridgeError, parseBridgeRequest } from './protocol';
import { publishBridgeStatus } from './status';
import { setHostRequester } from './hostRelay';

const logger = createLogger('background');
const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
// Host tools may run a shell command for minutes; the daemon enforces its own limits, this one is a backstop.
const HOST_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

type EventListener = (event: McpBridgeEventFrame) => void;

interface HostPending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function endpointKey(config: McpBridgeConfig): string {
  return `${config.host}:${config.port}|${config.token}`;
}

/**
 * Keeps one WebSocket to the local daemon while the setting is on. The daemon is the server;
 * the extension dials out, so no port is opened in the browser. The socket is used only after the
 * mutual HMAC handshake completes (see handshake.ts). The same socket carries requests in both
 * directions: the daemon's browser requests, and the extension's host-tool and CLI requests.
 */
export class McpBridgeClient {
  private socket: WebSocket | null = null;
  private readySocket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private config: McpBridgeConfig | null = null;
  private key = '';
  private readonly hostPending = new Map<string, HostPending>();
  private readonly listeners = new Set<EventListener>();

  isConnected(): boolean {
    return this.readySocket !== null;
  }

  /** Progress events pushed by the daemon. Returns the unsubscribe function. */
  subscribeEvents(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends a request to the daemon and resolves with its result. Rejects with McpBridgeError when it cannot answer. */
  hostRequest<T = unknown>(
    method: McpBridgeHostMethod,
    params: Record<string, unknown>,
    timeoutMs = HOST_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const socket = this.readySocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new McpBridgeError('BRIDGE_NOT_CONNECTED', t('bg_mcp_notConnected')));
    }
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.hostPending.delete(id);
        reject(new McpBridgeError('TIMEOUT', t('bg_mcp_hostTimeout')));
      }, timeoutMs);
      this.hostPending.set(id, { resolve: value => resolve(value as T), reject, timer });
      socket.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }

  apply(config: McpBridgeConfig): void {
    if (!config.enabled) {
      this.stop();
      return;
    }
    if (this.config && this.key === endpointKey(config)) return;
    this.stop();
    if (!isValidMcpBridgeToken(config.token)) {
      logger.warning('MCP bridge not started: the token is missing or shorter than 32 characters');
      return;
    }
    this.config = config;
    this.key = endpointKey(config);
    this.connect();
  }

  stop(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.config = null;
    this.key = '';
    this.attempts = 0;
    this.dropReady('BRIDGE_DISCONNECTED: the bridge was stopped');
    socket?.close();
  }

  private connect(): void {
    const config = this.config;
    if (!config) return;
    const socket = new WebSocket(`ws://${config.host}:${config.port}`);
    const handshake = new BridgeHandshake(config.token);
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify(handshake.helloFrame(chrome.runtime.getManifest().version)));
      handshakeTimer = setTimeout(() => {
        if (handshake.isReady()) return;
        logger.warning('MCP bridge handshake timed out');
        socket.close();
      }, MCP_BRIDGE_HANDSHAKE_TIMEOUT_MS);
    };
    socket.onmessage = event => {
      void this.handleFrame(socket, handshake, event.data);
    };
    socket.onclose = () => {
      if (handshakeTimer !== null) clearTimeout(handshakeTimer);
      if (this.readySocket === socket) {
        this.dropReady('BRIDGE_DISCONNECTED: the QAgent bridge connection closed');
      }
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleRetry();
    };
    // onerror is always followed by onclose, which owns the retry.
  }

  /** Forgets the ready socket: pending host requests fail and the status shows disconnected. */
  private dropReady(reason: string): void {
    if (this.readySocket === null && this.hostPending.size === 0) return;
    this.readySocket = null;
    for (const [id, pending] of this.hostPending) {
      clearTimeout(pending.timer);
      this.hostPending.delete(id);
      pending.reject(new McpBridgeError('BRIDGE_DISCONNECTED', reason));
    }
    void publishBridgeStatus(false);
  }

  private scheduleRetry(): void {
    if (!this.config) return;
    const delay = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private async handleFrame(socket: WebSocket, handshake: BridgeHandshake, data: unknown): Promise<void> {
    if (typeof data !== 'string') {
      socket.close();
      return;
    }
    const outcome = await handshake.handle(safeJson(data));
    // The handshake is async: a frame can settle after stop() or a reconnect replaced this socket. Such a frame must
    // not mark a dead socket as ready or send on it.
    if (this.socket !== socket) return;
    switch (outcome.kind) {
      case 'reply':
        socket.send(JSON.stringify(outcome.frame));
        return;
      case 'ready':
        this.attempts = 0;
        this.readySocket = socket;
        void publishBridgeStatus(true);
        logger.info('MCP bridge connected');
        return;
      case 'dispatch':
        await this.execute(socket, data);
        return;
      case 'response':
        this.settleHost(outcome.frame as unknown as McpBridgeResponseFrame);
        return;
      case 'event':
        this.emitEvent(outcome.frame as unknown as McpBridgeEventFrame);
        return;
      case 'drop':
        logger.warning('MCP bridge request dropped: the handshake is not complete');
        return;
      case 'ignore':
        return;
      case 'fail':
        logger.warning(`MCP bridge handshake failed: ${outcome.reason}`);
        socket.close();
        return;
    }
  }

  private settleHost(frame: McpBridgeResponseFrame): void {
    const pending = this.hostPending.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.hostPending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.result);
      return;
    }
    pending.reject(new McpBridgeError(frame.error.code, frame.error.message));
  }

  private emitEvent(event: McpBridgeEventFrame): void {
    if (typeof event.taskId !== 'string' || typeof event.state !== 'string') return;
    for (const listener of this.listeners) listener(event);
  }

  private async execute(socket: WebSocket, data: string): Promise<void> {
    let response;
    try {
      const request = parseBridgeRequest(data);
      const outcome = await handleBridgeRequest(request).then(
        result => ({ ok: true as const, result }),
        error => ({ ok: false as const, error }),
      );
      response = toBridgeResponse(request.id, outcome);
    } catch (error) {
      const id = extractRequestId(safeJson(data));
      if (!id) {
        logger.error('MCP bridge frame dropped', error);
        return;
      }
      response = toBridgeResponse(id, { ok: false, error });
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const mcpBridgeClient = new McpBridgeClient();

/** Starts the bridge client and follows settings changes. Call once from the service worker root. */
export function registerMcpBridge(): void {
  setHostRequester((method, params, timeoutMs) => mcpBridgeClient.hostRequest(method, params, timeoutMs));
  const apply = async () => {
    mcpBridgeClient.apply(await mcpBridgeStore.getConfig());
  };
  mcpBridgeStore.subscribe(() => void apply());
  void apply();
}
