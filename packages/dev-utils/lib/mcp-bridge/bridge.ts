import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
// Types only: at runtime this file must not depend on @extension/shared (a devDependency of this package).
import type { McpBridgeMethod, McpBridgeResponseFrame } from '@extension/shared';
import type { BridgeRequester } from './tools';

// Keep in sync with MCP_BRIDGE_DEFAULT_HOST / MCP_BRIDGE_DEFAULT_PORT in @extension/shared.
const MCP_BRIDGE_DEFAULT_HOST = '127.0.0.1';
const MCP_BRIDGE_DEFAULT_PORT = 9224;

export interface McpBridgeOptions {
  host?: string;
  port?: number;
  /** Shared secret the extension must send in its hello. Recommended. */
  token?: string;
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

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 1000;

function tokensMatch(expected: string, received: unknown): boolean {
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
 * WebSocket server the QAgent extension dials into. Only one authenticated extension is used at a time.
 * Security model mirrors the agent-browser companion: browsers always send Origin, so pages are refused;
 * the extension id and token narrow the set of clients further.
 */
export class QAgentMcpBridge implements BridgeRequester {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly extensionId?: string;
  private readonly taskTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: McpBridgeOptions = {}) {
    this.host = options.host ?? MCP_BRIDGE_DEFAULT_HOST;
    this.port = options.port ?? MCP_BRIDGE_DEFAULT_PORT;
    this.token = options.token ?? '';
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
      token: env.QAGENT_MCP_TOKEN?.trim() || undefined,
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
      verifyClient: ({ origin }: { origin?: string }) =>
        !origin ||
        (this.extensionId
          ? origin === `chrome-extension://${this.extensionId}`
          : origin.startsWith('chrome-extension://')),
    });
    this.wss.on('connection', ws => this.handleConnection(ws));
    await new Promise<void>((resolve, reject) => {
      this.wss?.once('listening', () => resolve());
      this.wss?.once('error', reject);
    });
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
    let authenticated = false;
    ws.on('message', raw => {
      const frame = parseFrame(raw);
      if (!frame) return;

      if (!authenticated) {
        if (frame.type !== 'hello') return ws.close(4001, 'hello required');
        if (this.token && !tokensMatch(this.token, frame.token)) return ws.close(4003, 'invalid token');
        authenticated = true;
        this.adoptSocket(ws);
        return;
      }

      if (isResponseFrame(frame)) this.settle(frame);
    });
    ws.on('close', () => {
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
