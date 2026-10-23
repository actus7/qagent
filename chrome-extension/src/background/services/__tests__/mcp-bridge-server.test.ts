import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { MCP_BRIDGE_CLIENT_PROOF_LABEL, MCP_BRIDGE_SERVER_PROOF_LABEL } from '@extension/shared';
import { mcpBridgeProof, QAgentMcpBridge } from '../../../../../packages/dev-utils/lib/mcp-bridge/bridge';
import { randomHex } from '../mcpBridge/handshake';

const TOKEN = 'test-token-0123456789-abcdefghijklmnop';
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const CLOSE_TIMEOUT_MS = 2000;

type Frame = Record<string, unknown>;
type NodeWebSocket = WebSocket;
type NodeWebSocketCtor = new (url: string, options?: { headers?: Record<string, string> }) => NodeWebSocket;
// Node's global WebSocket (undici) accepts a headers option, which the DOM typings do not declare.
const WebSocketWithHeaders = globalThis.WebSocket as unknown as NodeWebSocketCtor;

interface Client {
  ws: NodeWebSocket;
  next: () => Promise<Frame>;
  closed: Promise<number>;
}

/** Sends a raw WebSocket upgrade with an exact Origin (or none) and resolves to the HTTP status. */
function upgradeStatus(url: string, origin: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
    };
    if (origin) headers.Origin = origin;
    const req = httpRequest({ host: hostname, port, path: '/', headers });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('response', res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Opens a socket with the given Origin. Rejects when the server closes before the upgrade completes. */
function connect(url: string, origin: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const queue: Frame[] = [];
    const waiters: Array<(frame: Frame) => void> = [];
    const ws = new WebSocketWithHeaders(url, { headers: { origin } });
    let opened = false;
    ws.addEventListener('message', event => {
      const frame = JSON.parse(String(event.data)) as Frame;
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    });
    const closed = new Promise<number>(res => {
      ws.addEventListener('close', event => {
        if (!opened) reject(new Error(`closed before open: ${event.code}`));
        res(event.code);
      });
    });
    ws.addEventListener('error', () => undefined);
    ws.addEventListener('open', () => {
      opened = true;
      resolve({
        ws,
        closed,
        next: () =>
          queue.length > 0 ? Promise.resolve(queue.shift() as Frame) : new Promise<Frame>(res => waiters.push(res)),
      });
    });
  });
}

async function waitForClose(client: Client): Promise<number> {
  return Promise.race([
    client.closed,
    new Promise<number>((_, reject) => setTimeout(() => reject(new Error('socket stayed open')), CLOSE_TIMEOUT_MS)),
  ]);
}

describe('QAgentMcpBridge configuration', () => {
  it('refuses to start without QAGENT_MCP_TOKEN and explains how to generate one', () => {
    expect(() => QAgentMcpBridge.fromEnv({})).toThrow(/QAGENT_MCP_TOKEN is required.*randomBytes/s);
  });

  it('refuses a token shorter than 32 characters', () => {
    expect(() => QAgentMcpBridge.fromEnv({ QAGENT_MCP_TOKEN: 'short' })).toThrow(/at least 32 characters/);
  });

  it('accepts a token of at least 32 characters', () => {
    expect(() => QAgentMcpBridge.fromEnv({ QAGENT_MCP_TOKEN: TOKEN })).not.toThrow();
  });
});

describe('QAgentMcpBridge handshake', () => {
  let bridge: QAgentMcpBridge | null = null;
  const clients: Client[] = [];

  async function start(): Promise<string> {
    bridge = new QAgentMcpBridge({ host: '127.0.0.1', port: 0, token: TOKEN });
    await bridge.start();
    return bridge.getAddress();
  }

  async function openExtension(url: string): Promise<Client> {
    const client = await connect(url, EXTENSION_ORIGIN);
    clients.push(client);
    return client;
  }

  afterEach(async () => {
    for (const client of clients.splice(0)) client.ws.close();
    await bridge?.stop();
    bridge = null;
  });

  it('refuses a connection that has no Origin header', async () => {
    const url = await start();
    expect(await upgradeStatus(url, undefined)).toBe(401);
  });

  it('refuses a web page origin', async () => {
    const url = await start();
    expect(await upgradeStatus(url, 'https://example.com')).toBe(401);
  });

  it('accepts the extension origin on the raw upgrade', async () => {
    const url = await start();
    expect(await upgradeStatus(url, EXTENSION_ORIGIN)).toBe(101);
  });

  it('completes the mutual handshake and then carries requests', async () => {
    const url = await start();
    const client = await openExtension(url);
    const extNonce = randomHex(32);
    client.ws.send(JSON.stringify({ type: 'hello', nonce: extNonce, extensionVersion: '0.1.13' }));

    const challenge = await client.next();
    expect(challenge).toMatchObject({ type: 'challenge' });
    const srvNonce = String(challenge.nonce);
    // The extension-side check: the server must know the token.
    expect(challenge.proof).toBe(mcpBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, extNonce, srvNonce));

    client.ws.send(
      JSON.stringify({
        type: 'auth',
        proof: mcpBridgeProof(TOKEN, MCP_BRIDGE_CLIENT_PROOF_LABEL, srvNonce, extNonce),
      }),
    );
    expect(await client.next()).toEqual({ type: 'ready' });
    expect(bridge?.isExtensionConnected()).toBe(true);

    const result = bridge!.request('get_status', {});
    const request = await client.next();
    expect(request).toMatchObject({ type: 'request', method: 'get_status' });
    client.ws.send(JSON.stringify({ type: 'response', id: request.id, ok: true, result: { busy: false } }));
    await expect(result).resolves.toEqual({ busy: false });
  });

  it('never puts the raw token on the wire', async () => {
    const url = await start();
    const client = await openExtension(url);
    const extNonce = randomHex(32);
    client.ws.send(JSON.stringify({ type: 'hello', nonce: extNonce, extensionVersion: '0.1.13' }));
    const challenge = await client.next();
    expect(JSON.stringify(challenge)).not.toContain(TOKEN);
  });

  it('closes the socket when the client proof is wrong', async () => {
    const url = await start();
    const client = await openExtension(url);
    const extNonce = randomHex(32);
    client.ws.send(JSON.stringify({ type: 'hello', nonce: extNonce, extensionVersion: '0.1.13' }));
    const challenge = await client.next();
    client.ws.send(
      JSON.stringify({
        type: 'auth',
        proof: mcpBridgeProof(
          'wrong-token-0123456789-abcdefghijklmn',
          MCP_BRIDGE_CLIENT_PROOF_LABEL,
          String(challenge.nonce),
          extNonce,
        ),
      }),
    );
    expect(await waitForClose(client)).toBe(4001);
    expect(bridge?.isExtensionConnected()).toBe(false);
  });

  it('closes when auth arrives before hello', async () => {
    const url = await start();
    const client = await openExtension(url);
    client.ws.send(JSON.stringify({ type: 'auth', proof: 'a'.repeat(64) }));
    expect(await waitForClose(client)).toBe(4001);
    expect(bridge?.isExtensionConnected()).toBe(false);
  });

  it('closes when a request arrives before the handshake', async () => {
    const url = await start();
    const client = await openExtension(url);
    client.ws.send(JSON.stringify({ type: 'request', id: 'x', method: 'get_status', params: {} }));
    expect(await waitForClose(client)).toBe(4001);
  });

  it('closes on a hello with a malformed nonce', async () => {
    const url = await start();
    const client = await openExtension(url);
    client.ws.send(JSON.stringify({ type: 'hello', nonce: 'short', extensionVersion: '0.1.13' }));
    expect(await waitForClose(client)).toBe(4001);
  });
});
