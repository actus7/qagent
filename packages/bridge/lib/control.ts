// Local control channel. The MCP server and `qagent status|stop` talk to the running daemon here.
// Loopback only, bearer token required, and browser-originated requests (which carry an Origin header) are refused.
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  BridgeError,
  CONTROL_DEFAULT_PORT,
  MCP_BRIDGE_DEFAULT_HOST,
  MCP_BRIDGE_METHODS,
  MCP_BRIDGE_MIN_TOKEN_LENGTH,
  type McpBridgeMethod,
} from './protocol';
import type { BridgeRequester } from './tools';

const MAX_BODY_BYTES = 1024 * 1024;
const CLIENT_TIMEOUT_MS = 30_000;
const HOST_CONTROL_METHODS: ReadonlySet<string> = new Set([
  'shell_exec',
  'fs_read',
  'fs_write',
  'fs_list',
  'fs_search',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export interface ControlTarget {
  request(method: McpBridgeMethod, params: Record<string, unknown>): Promise<unknown>;
  host(method: string, params: Record<string, unknown>): Promise<unknown>;
  isExtensionConnected(): boolean;
}

export interface ControlServerOptions {
  host?: string;
  port?: number;
  token: string;
  target: ControlTarget;
  /** Extra fields for GET /v1/status, such as the daemon's pid and the CLI agents found on PATH. */
  describe: () => Record<string, unknown>;
  onShutdown: () => void;
}

interface Envelope {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BridgeError('INVALID_REQUEST', 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new BridgeError('INVALID_REQUEST', 'Body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

function envelopeFor(error: unknown): Envelope {
  if (error instanceof BridgeError) return { ok: false, error: { code: error.code, message: error.message } };
  const message = error instanceof Error ? error.message : String(error);
  // A bridge error arrives as "CODE: message"; keep the code so the caller can branch on it.
  const match = /^([A-Z_]+): ([\s\S]*)$/.exec(message);
  if (match) return { ok: false, error: { code: match[1], message: match[2] } };
  return { ok: false, error: { code: 'INTERNAL', message } };
}

export class ControlServer {
  private server: Server | null = null;
  private port: number;
  private readonly host: string;
  private readonly token: string;

  constructor(private readonly options: ControlServerOptions) {
    this.token = options.token;
    this.host = options.host ?? MCP_BRIDGE_DEFAULT_HOST;
    this.port = options.port ?? CONTROL_DEFAULT_PORT;
    if (!LOOPBACK_HOSTS.has(this.host)) throw new Error('The control channel only listens on 127.0.0.1 or localhost');
    if (this.token.length < MCP_BRIDGE_MIN_TOKEN_LENGTH) throw new Error('The control channel needs a strong token');
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => resolve());
    });
    const address = server.address();
    if (typeof address === 'object' && address !== null) this.port = address.port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Browsers attach Origin to cross-site requests; the CLI and MCP client never do.
    if (req.headers.origin !== undefined)
      return send(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Origin not allowed' } });
    if (!tokenMatches(req.headers.authorization, this.token)) {
      return send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or wrong token' } });
    }
    const route = `${req.method ?? ''} ${req.url ?? ''}`;
    try {
      if (route === 'GET /v1/status') {
        return send(res, 200, {
          ok: true,
          result: { ...this.options.describe(), extensionConnected: this.options.target.isExtensionConnected() },
        });
      }
      if (route === 'POST /v1/shutdown') {
        send(res, 200, { ok: true, result: { stopping: true } });
        setImmediate(this.options.onShutdown);
        return;
      }
      if (route === 'POST /v1/request' || route === 'POST /v1/host') {
        const body = await readBody(req);
        const result = await this.dispatch(route.endsWith('/request'), body);
        return send(res, 200, { ok: true, result });
      }
      return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown route' } });
    } catch (error) {
      return send(res, 200, envelopeFor(error));
    }
  }

  private dispatch(toBridge: boolean, body: Record<string, unknown>): Promise<unknown> {
    const method = typeof body.method === 'string' ? body.method : '';
    const params =
      typeof body.params === 'object' && body.params !== null ? (body.params as Record<string, unknown>) : {};
    if (toBridge) {
      if (!(MCP_BRIDGE_METHODS as readonly string[]).includes(method)) {
        throw new BridgeError('INVALID_REQUEST', `Unsupported bridge method: ${method}`);
      }
      return this.options.target.request(method as McpBridgeMethod, params);
    }
    if (!HOST_CONTROL_METHODS.has(method))
      throw new BridgeError('INVALID_REQUEST', `Unsupported host method: ${method}`);
    return this.options.target.host(method, params);
  }
}

/** Client for the control channel. Throws DAEMON_UNREACHABLE when nothing listens on the port. */
export class ControlClient implements BridgeRequester {
  constructor(
    private readonly port: number,
    private readonly token: string,
    private readonly address = MCP_BRIDGE_DEFAULT_HOST,
  ) {}

  status(): Promise<Record<string, unknown>> {
    return this.call('GET', '/v1/status') as Promise<Record<string, unknown>>;
  }

  request(method: McpBridgeMethod, params: Record<string, unknown>): Promise<unknown> {
    return this.call('POST', '/v1/request', { method, params });
  }

  /** Runs a host tool inside the daemon, for the CLI's smoke checks and debugging. */
  host(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.call('POST', '/v1/host', { method, params });
  }

  shutdown(): Promise<unknown> {
    return this.call('POST', '/v1/shutdown');
  }

  private call(method: string, path: string, body?: unknown): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: this.address,
          port: this.port,
          method,
          path,
          timeout: CLIENT_TIMEOUT_MS,
          headers: {
            authorization: `Bearer ${this.token}`,
            ...(payload === undefined
              ? {}
              : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            let envelope: Envelope;
            try {
              envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Envelope;
            } catch {
              reject(new BridgeError('DAEMON_ERROR', 'The daemon sent an unreadable answer'));
              return;
            }
            if (envelope.ok) resolve(envelope.result);
            else reject(new BridgeError(envelope.error?.code ?? 'ERROR', envelope.error?.message ?? 'Request failed'));
          });
        },
      );
      req.on('timeout', () => req.destroy(new BridgeError('TIMEOUT', 'The daemon did not answer in time')));
      req.on('error', error => {
        if (error instanceof BridgeError) reject(error);
        else reject(new BridgeError('DAEMON_UNREACHABLE', 'No QAgent daemon answers on the control port'));
      });
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}
