import { createLogger } from '@src/background/log';
import type {
  CompanionInboundMessage,
  CompanionInputMessage,
  CompanionRpcRequest,
  CompanionRpcResponse,
  CompanionStatusMessage,
  CompanionFrameMessage,
  CompanionAction,
} from './protocol';

type PendingRequest = {
  resolve: (value: CompanionRpcResponse) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type FrameListener = (message: CompanionFrameMessage) => void;
type StatusListener = (message: CompanionStatusMessage) => void;

const logger = createLogger('AgentBrowserCompanionClient');

export interface AgentBrowserCompanionClientOptions {
  url: string;
  token?: string;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_CONNECT_MAX_ATTEMPTS = 3;
const CONNECT_RETRY_DELAYS_MS = [250, 500];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildCompanionOfflineError(url: string): Error {
  return new Error(
    `Failed to connect to BrowserManager companion at ${url}. ` +
      'Start it with "pnpm companion:agent-browser" in the project root and keep it running.',
  );
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInboundMessage(value: unknown): value is CompanionInboundMessage {
  if (!isObject(value) || typeof value.type !== 'string') {
    return false;
  }

  return value.type === 'rpc_response' || value.type === 'frame' || value.type === 'status';
}

export class AgentBrowserCompanionClient {
  private readonly url: string;
  private readonly token?: string;
  private readonly requestTimeoutMs: number;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private lastStatus: CompanionStatusMessage = { type: 'status', connected: false, authenticated: false };

  constructor(options: AgentBrowserCompanionClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  getStatus(): CompanionStatusMessage {
    return this.lastStatus;
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.lastStatus);
    return () => this.statusListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connectWithRetry().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise as Promise<void>;
  }

  private async connectWithRetry(maxAttempts = DEFAULT_CONNECT_MAX_ATTEMPTS): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }
        const delayMs = CONNECT_RETRY_DELAYS_MS[Math.min(attempt - 1, CONNECT_RETRY_DELAYS_MS.length - 1)];
        await sleep(delayMs);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw buildCompanionOfflineError(this.url);
  }

  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      let settled = false;

      const finalize = (onFinalize: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        onFinalize();
      };

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };

      const onOpen = () => {
        this.ws = ws;
        this.bindSocket(ws);
        if (this.token) {
          ws.send(JSON.stringify({ type: 'hello', token: this.token }));
        }
        finalize(resolve);
      };

      const onError = (event: Event) => {
        logger.error('Companion websocket connection error', event);
        finalize(() => reject(buildCompanionOfflineError(this.url)));
      };

      const onClose = () => {
        finalize(() => reject(buildCompanionOfflineError(this.url)));
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
  }

  async request(sessionId: string, taskId: string, action: CompanionAction): Promise<CompanionRpcResponse> {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Companion websocket is not connected');
    }

    const id = randomId();
    const payload: CompanionRpcRequest = {
      type: 'rpc_request',
      id,
      sessionId,
      taskId,
      action,
    };

    return new Promise<CompanionRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Companion request timed out (${action.action})`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws?.send(JSON.stringify(payload));
    });
  }

  async sendInput(input: CompanionInputMessage): Promise<void> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Companion websocket is not connected');
    }
    this.ws.send(JSON.stringify(input));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Companion disconnected while waiting for response (${id})`));
    }
    this.pending.clear();

    this.lastStatus = { type: 'status', connected: false, authenticated: false };
    for (const listener of this.statusListeners) {
      listener(this.lastStatus);
    }
  }

  private bindSocket(ws: WebSocket): void {
    ws.addEventListener('message', event => {
      this.handleMessage(event.data);
    });

    ws.addEventListener('close', () => {
      this.ws = null;
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Companion socket closed before response (${id})`));
      }
      this.pending.clear();

      this.lastStatus = { type: 'status', connected: false, authenticated: false };
      for (const listener of this.statusListeners) {
        listener(this.lastStatus);
      }
    });

    ws.addEventListener('error', event => {
      logger.error('Companion websocket runtime error', event);
    });
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch (error) {
      logger.warning('Ignoring non-JSON companion message', error);
      return;
    }

    if (!isInboundMessage(parsed)) {
      logger.debug('Ignoring unknown companion message', parsed);
      return;
    }

    if (parsed.type === 'rpc_response') {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);
      pending.resolve(parsed);
      return;
    }

    if (parsed.type === 'frame') {
      for (const listener of this.frameListeners) {
        listener(parsed);
      }
      return;
    }

    this.lastStatus = parsed;
    for (const listener of this.statusListeners) {
      listener(parsed);
    }
  }
}
