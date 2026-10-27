import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The client module imports the storage and i18n packages, which expect a browser extension runtime.
vi.mock('webextension-polyfill', () => ({}));
import { MCP_BRIDGE_SERVER_PROOF_LABEL } from '@extension/shared';
import type { McpBridgeConfig } from '@extension/storage';
import { McpBridgeClient } from '../mcpBridge/client';
import { computeBridgeProof } from '../mcpBridge/handshake';

const TOKEN = 'test-token-0123456789-abcdefghijklmnop';
const SERVER_NONCE = 'b'.repeat(64);
const CONFIG: McpBridgeConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 9999,
  token: TOKEN,
  cliAgent: 'off',
};

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

/** Lets the async handshake settle: its HMAC runs on the crypto threadpool, outside the microtask queue. */
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

/** Opens the socket and returns the nonce of the hello frame the client sent. */
function openSocket(socket: FakeSocket): string {
  socket.readyState = FakeSocket.OPEN;
  socket.onopen?.();
  return (JSON.parse(socket.sent[0]) as { nonce: string }).nonce;
}

async function challengeFrame(helloNonce: string): Promise<string> {
  const proof = await computeBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, helloNonce, SERVER_NONCE);
  return JSON.stringify({ type: 'challenge', nonce: SERVER_NONCE, proof });
}

describe('McpBridgeClient handshake frames', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.0.0' }) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers the server challenge on the live socket', async () => {
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    const socket = FakeSocket.instances[0];
    const helloNonce = openSocket(socket);

    socket.onmessage?.({ data: await challengeFrame(helloNonce) });
    await settle();

    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1])).toMatchObject({ type: 'auth' });
    client.stop();
  });

  it('ignores a challenge that arrives after the socket was stopped', async () => {
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    const socket = FakeSocket.instances[0];
    const helloNonce = openSocket(socket);
    const frame = await challengeFrame(helloNonce);

    client.stop();
    socket.onmessage?.({ data: frame });
    await settle();

    expect(socket.sent).toHaveLength(1);
    expect(client.isConnected()).toBe(false);
  });
});
