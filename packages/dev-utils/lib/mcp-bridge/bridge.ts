import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
// Types only: at runtime this file must not depend on @extension/shared (a devDependency of this package).
import type { McpBridgeMethod, McpBridgeResponseFrame } from '@extension/shared';
import type { BridgeRequester } from './tools';

// Keep in sync with MCP_BRIDGE_DEFAULT_HOST / MCP_BRIDGE_DEFAULT_PORT in @extension/shared.
const MCP_BRIDGE_DEFAULT_HOST = '127.0.0.1';
const MCP_BRIDGE_DEFAULT_PORT = 9224;
// Keep in sync with the proof labels and handshake timeout in @extension/shared (mcp-bridge-protocol.ts).
export const MCP_BRIDGE_SERVER_PROOF_LABEL = 'qagent-mcp-bridge/v1/server';
export const MCP_BRIDGE_CLIENT_PROOF_LABEL = 'qagent-mcp-bridge/v1/client';
const HANDSHAKE_TIMEOUT_MS = 5000;
export const MCP_BRIDGE_MIN_TOKEN_LENGTH = 32;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;

export interface McpBridgeOptions {
  host?: string;
  port?: number;
  /** Shared secret for the HMAC handshake. Required, at least 32 characters. */
  token: string;
  /** Exact extension id allowed to connect; any chrome-extension:// origin when unset. */
  extensionId?: string;
  /** Upper bound for run_task, which waits for the whole task. */
  taskTimeoutMs?: number;
  requestTimeoutMs?: number;
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
    this.wss.on('connection', ws => this.handleConnection(ws));
    await new Promise<void>((resolve, reject) => {
      this.wss?.once('listening', () => resolve());
      this.wss?.once('error', reject);
    });
    // Port 0 asks the OS for a free port; report the one actually bound.
    const address = this.wss?.address();
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
          'EXTENSION_NOT_CONNECTED: Abra o Chrome com a extensÃ£o QAgent e ative "Permitir controle por clientes MCP locais".',
        ),
      );
    }
    const id = randomUUID();
    const timeoutMs = method === 'run_task' ? this.taskTimeoutMs : this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`TIMEOUT: no answer from the extension within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }

  private handleConnection(ws: WebSocket): void {
    let state: HandshakeState | 'authenticated' = { step: 'hello' };
    const timer = setTimeout(() => ws.close(4005, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS);
    ws.on('message', raw => {
      const frame = parseFrame(raw);
      if (state === 'authenticated') {
        if (frame && isResponseFrame(frame)) this.settle(frame);
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

  private adoptSocket(ws: WebSocket): void {
    if (this.socket && this.socket !== ws) {
      // The newest authenticated extension wins; requests in flight on the old one cannot be answered.
      this.rejectAll('EXTENSION_REPLACED: another QAgent extension connected');
      this.socket.close(4002, 'replaced');
    }
    this.socket = ws;
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
