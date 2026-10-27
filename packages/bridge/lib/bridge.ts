import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  BridgeError,
  MCP_BRIDGE_CLIENT_PROOF_LABEL,
  MCP_BRIDGE_DEFAULT_HOST,
  MCP_BRIDGE_DEFAULT_PORT,
  MCP_BRIDGE_HOST_METHODS,
  MCP_BRIDGE_MIN_TOKEN_LENGTH,
  MCP_BRIDGE_SERVER_PROOF_LABEL,
  type McpBridgeEventFrame,
  type McpBridgeHostMethod,
  type McpBridgeMethod,
  type McpBridgeResponseFrame,
} from './protocol';
import type { BridgeRequester } from './tools';

export { MCP_BRIDGE_CLIENT_PROOF_LABEL, MCP_BRIDGE_MIN_TOKEN_LENGTH, MCP_BRIDGE_SERVER_PROOF_LABEL };
const HANDSHAKE_TIMEOUT_MS = 5000;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;

/** Answers the requests the extension makes to the daemon (host tools, CLI agents). */
export interface ExtensionHandler {
  handle(
    method: McpBridgeHostMethod,
    params: Record<string, unknown>,
    sendEvent: (event: McpBridgeEventFrame) => void,
  ): Promise<unknown>;
}

export interface McpBridgeOptions {
  host?: string;
  port?: number;
  /** Shared secret for the HMAC handshake. Required, at least 32 characters. */
  token: string;
  /** Exact extension id allowed to connect; any chrome-extension:// origin when unset. */
  extensionId?: string;
  /** Upper bound for run_task and run_action, which wait for the browser. */
  taskTimeoutMs?: number;
  requestTimeoutMs?: number;
  handler?: ExtensionHandler;
  /** Called after an extension completes the handshake, so the action list can be refreshed. */
  onExtensionConnected?: () => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type HandshakeState = { step: 'hello' } | { step: 'auth'; extNonce: string; srvNonce: string };

interface HandshakeStep {
  next: HandshakeState | 'authenticated';
  reply: Record<string, unknown>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 1000;
// Methods that wait for the browser or a whole task get the long timeout.
const LONG_METHODS: ReadonlySet<string> = new Set(['run_task', 'run_action']);
const HOST_METHODS: ReadonlySet<string> = new Set<string>(MCP_BRIDGE_HOST_METHODS);

/** HMAC-SHA256(token, `${label}|${first}|${second}`), hex encoded. The raw token never leaves the process. */
export function mcpBridgeProof(token: string, label: string, first: string, second: string): string {
  return createHmac('sha256', token).update(`${label}|${first}|${second}`).digest('hex');
}

function hexEqual(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseFrame(raw: RawData): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isResponseFrame(value: Record<string, unknown>): value is McpBridgeResponseFrame & Record<string, unknown> {
  return value.type === 'response' && typeof value.id === 'string' && typeof value.ok === 'boolean';
}

/**
 * Advances the handshake by one frame. Returns null when the frame is not the one expected at this step.
 * Steps: hello -> (challenge) -> auth -> (ready). The server proves the token first, then checks the client.
 */
function handshakeStep(
  token: string,
  state: HandshakeState,
  frame: Record<string, unknown> | null,
): HandshakeStep | null {
  if (!frame) return null;
  if (state.step === 'hello') {
    if (frame.type !== 'hello' || typeof frame.nonce !== 'string' || !NONCE_PATTERN.test(frame.nonce)) return null;
    if (typeof frame.extensionVersion !== 'string') return null;
    const srvNonce = randomBytes(32).toString('hex');
    return {
      next: { step: 'auth', extNonce: frame.nonce, srvNonce },
      reply: {
        type: 'challenge',
        nonce: srvNonce,
        proof: mcpBridgeProof(token, MCP_BRIDGE_SERVER_PROOF_LABEL, frame.nonce, srvNonce),
      },
    };
  }
  if (frame.type !== 'auth') return null;
  const expected = mcpBridgeProof(token, MCP_BRIDGE_CLIENT_PROOF_LABEL, state.srvNonce, state.extNonce);
  if (!hexEqual(expected, frame.proof)) return null;
  return { next: 'authenticated', reply: { type: 'ready' } };
}

/**
 * WebSocket server the QAgent extension dials into. Only one authenticated extension is used at a time.
 * Mutual HMAC-SHA256 handshake over a shared token, a required Origin of chrome-extension://, and an
 * optional exact extension id narrow the set of clients. Requests are only sent after `ready`.
 */
export class QAgentMcpBridge implements BridgeRequester {
  private readonly host: string;
  private port: number;
  private readonly token: string;
  private readonly extensionId?: string;
  private readonly taskTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly handler?: ExtensionHandler;
  private readonly onExtensionConnected?: () => void;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: McpBridgeOptions) {
    if (typeof options.token !== 'string' || options.token.length < MCP_BRIDGE_MIN_TOKEN_LENGTH) {
      throw new Error(
        `QAGENT_MCP_TOKEN is required and must have at least ${MCP_BRIDGE_MIN_TOKEN_LENGTH} characters. ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    this.host = options.host ?? MCP_BRIDGE_DEFAULT_HOST;
    this.port = options.port ?? MCP_BRIDGE_DEFAULT_PORT;
    this.token = options.token;
    this.extensionId = options.extensionId;
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.handler = options.handler;
    this.onExtensionConnected = options.onExtensionConnected;
    if (!LOOPBACK_HOSTS.has(this.host)) {
      throw new Error('QAgent MCP bridge only listens on 127.0.0.1 or localhost');
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): QAgentMcpBridge {
    const port = Number.parseInt(env.QAGENT_MCP_PORT ?? String(MCP_BRIDGE_DEFAULT_PORT), 10);
    const taskTimeoutMs = Number.parseInt(env.QAGENT_MCP_TASK_TIMEOUT_MS ?? String(DEFAULT_TASK_TIMEOUT_MS), 10);
    return new QAgentMcpBridge({
      host: env.QAGENT_MCP_HOST?.trim() || MCP_BRIDGE_DEFAULT_HOST,
      port: Number.isFinite(port) ? port : MCP_BRIDGE_DEFAULT_PORT,
      token: env.QAGENT_MCP_TOKEN?.trim() ?? '',
      extensionId: env.QAGENT_MCP_EXTENSION_ID?.trim() || undefined,
      taskTimeoutMs: Number.isFinite(taskTimeoutMs) ? taskTimeoutMs : DEFAULT_TASK_TIMEOUT_MS,
    });
  }

  getAddress(): string {
    return `ws://${this.host}:${this.port}`;
  }

  isExtensionConnected(): boolean {
    return this.socket !== null;
  }

  async start(): Promise<void> {
    if (this.wss) return;
    this.wss = new WebSocketServer({
      host: this.host,
      port: this.port,
      // Browsers always send Origin for WebSocket, so a missing Origin means a non-browser client: refused.
      verifyClient: ({ origin }: { origin?: string }) =>
        !!origin &&
        (this.extensionId
          ? origin === `chrome-extension://${this.extensionId}`
          : origin.startsWith('chrome-extension://')),
    });
    const server = this.wss;
    server.on('connection', ws => this.handleConnection(ws));
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', error => {
        // Nothing listens after a failed bind, so a later start() must try again instead of returning early.
        if (this.wss === server) this.wss = null;
        reject(error);
      });
    });
    // Port 0 asks the OS for a free port; report the one actually bound.
    const address = server.address();
    if (typeof address === 'object' && address !== null) this.port = address.port;
  }

  async stop(): Promise<void> {
    this.rejectAll('QAgent MCP bridge is shutting down');
    this.socket?.close();
    this.socket = null;
    const server = this.wss;
    this.wss = null;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  request(method: McpBridgeMethod, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error(
          'EXTENSION_NOT_CONNECTED: Abra o Chrome com a extensão QAgent e ative "Permitir controle por clientes MCP locais".',
        ),
      );
    }
    const id = randomUUID();
    const timeoutMs = LONG_METHODS.has(method) ? this.taskTimeoutMs : this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`TIMEOUT: no answer from the extension within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }

  /** Pushes a progress event to the extension; dropped silently when no extension is connected. */
  sendEvent(event: McpBridgeEventFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private handleConnection(ws: WebSocket): void {
    let state: HandshakeState | 'authenticated' = { step: 'hello' };
    const timer = setTimeout(() => ws.close(4005, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS);
    ws.on('message', raw => {
      const frame = parseFrame(raw);
      if (state === 'authenticated') {
        if (frame && isResponseFrame(frame)) this.settle(frame);
        else if (frame && frame.type === 'request') void this.answerExtension(ws, frame);
        return;
      }
      const step = handshakeStep(this.token, state, frame);
      if (!step) {
        clearTimeout(timer);
        ws.close(4001, 'handshake failed');
        return;
      }
      ws.send(JSON.stringify(step.reply));
      state = step.next;
      if (state === 'authenticated') {
        clearTimeout(timer);
        this.adoptSocket(ws);
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (this.socket !== ws) return;
      this.socket = null;
      this.rejectAll('EXTENSION_DISCONNECTED: the QAgent extension disconnected');
    });
  }

  /** Runs one extension request. Only host methods are accepted; anything else gets INVALID_REQUEST. */
  private async answerExtension(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const id = typeof frame.id === 'string' ? frame.id : null;
    if (id === null) return;
    const method = typeof frame.method === 'string' ? frame.method : '';
    const params = typeof frame.params === 'object' && frame.params !== null ? frame.params : {};
    let response: McpBridgeResponseFrame;
    try {
      if (!HOST_METHODS.has(method) || !this.handler) {
        throw new BridgeError('INVALID_REQUEST', 'Unsupported request method');
      }
      const sendEvent = (event: McpBridgeEventFrame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      };
      const result = await this.handler.handle(
        method as McpBridgeHostMethod,
        params as Record<string, unknown>,
        sendEvent,
      );
      response = { type: 'response', id, ok: true, result };
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : 'INTERNAL';
      const message = error instanceof Error ? error.message : String(error);
      response = { type: 'response', id, ok: false, error: { code, message } };
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  }

  private adoptSocket(ws: WebSocket): void {
    if (this.socket && this.socket !== ws) {
      // The newest authenticated extension wins; requests in flight on the old one cannot be answered.
      this.rejectAll('EXTENSION_REPLACED: another QAgent extension connected');
      this.socket.close(4002, 'replaced');
    }
    this.socket = ws;
    this.onExtensionConnected?.();
  }

  private settle(frame: McpBridgeResponseFrame & Record<string, unknown>): void {
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.result);
      return;
    }
    const error = frame.error as { code?: unknown; message?: unknown } | undefined;
    const code = typeof error?.code === 'string' ? error.code : 'ERROR';
    const message = typeof error?.message === 'string' ? error.message : 'Extension request failed';
    pending.reject(new Error(`${code}: ${message}`));
  }

  private rejectAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
