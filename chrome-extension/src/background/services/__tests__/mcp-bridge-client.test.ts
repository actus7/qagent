import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The client module imports the storage and i18n packages, which expect a browser extension runtime.
vi.mock('webextension-polyfill', () => ({}));
import { MCP_BRIDGE_SERVER_PROOF_LABEL } from '@extension/shared';
import type { McpBridgeConfig } from '@extension/storage';
import { McpBridgeClient, RECONNECT_ALARM_NAME } from '../mcpBridge/client';
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

const alarms = {
  create: vi.fn(),
  clear: vi.fn(async () => true),
};

/** Chrome APIs the client touches: runtime for the version, alarms for the reconnect, session storage for status. */
function stubChrome(): void {
  alarms.create.mockClear();
  alarms.clear.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '0.0.0' }) },
    alarms,
    storage: { session: { set: vi.fn(async () => undefined) } },
  });
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 426 })));
    stubChrome();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers the server challenge on the live socket', async () => {
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    await settle();
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
    await settle();
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

describe('McpBridgeClient reconnect', () => {
  let probe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeSocket.instances = [];
    probe = vi.fn(async () => new Response(null, { status: 426 }));
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', probe);
    stubChrome();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not open a WebSocket while the bridge port refuses, and arms the reconnect alarm', async () => {
    probe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    await settle();

    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:9999/', expect.objectContaining({ mode: 'no-cors' }));
    expect(FakeSocket.instances).toHaveLength(0);
    expect(alarms.create).toHaveBeenCalledWith(RECONNECT_ALARM_NAME, { periodInMinutes: 0.5 });
    client.stop();
  });

  it('connects when the alarm wakes the client, without waiting for the lost retry timer', async () => {
    probe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    await settle();

    client.wake();
    await settle();

    expect(FakeSocket.instances).toHaveLength(1);
    client.stop();
  });

  it('does not open a second socket when woken while one is already connecting', async () => {
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    client.wake();
    await settle();

    expect(FakeSocket.instances).toHaveLength(1);
    client.stop();
  });

  it('clears the alarm once the handshake completes', async () => {
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    await settle();
    const socket = FakeSocket.instances[0];
    const helloNonce = openSocket(socket);
    socket.onmessage?.({ data: await challengeFrame(helloNonce) });
    await settle();
    socket.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
    await settle();

    expect(client.isConnected()).toBe(true);
    expect(alarms.clear).toHaveBeenCalledWith(RECONNECT_ALARM_NAME);
    client.stop();
  });

  it('clears the alarm when the bridge is stopped', async () => {
    probe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new McpBridgeClient();
    client.apply(CONFIG);
    await settle();

    client.stop();

    expect(alarms.clear).toHaveBeenCalledWith(RECONNECT_ALARM_NAME);
  });
});
