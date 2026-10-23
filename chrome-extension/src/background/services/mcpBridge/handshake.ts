import {
  MCP_BRIDGE_CLIENT_PROOF_LABEL,
  MCP_BRIDGE_SERVER_PROOF_LABEL,
  type McpBridgeAuthFrame,
  type McpBridgeHelloFrame,
} from '@extension/shared';

const NONCE_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

export type HandshakeOutcome =
  | { kind: 'reply'; frame: McpBridgeAuthFrame }
  | { kind: 'ready' }
  | { kind: 'dispatch' }
  | { kind: 'drop' }
  | { kind: 'ignore' }
  | { kind: 'fail'; reason: string };

type Phase = 'awaiting_challenge' | 'verifying' | 'awaiting_ready' | 'ready';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Random bytes as lowercase hex. */
export function randomHex(byteLength: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** HMAC-SHA256(token, `${label}|${first}|${second}`), hex encoded. Matches QAgentMcpBridge's mcpBridgeProof. */
export async function computeBridgeProof(token: string, label: string, first: string, second: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${label}|${first}|${second}`));
  return toHex(new Uint8Array(signature));
}

/** Compares two hex strings without early exit on the first differing character. */
export function constantTimeEqual(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extension side of the mutual handshake for one socket. The extension proves nothing until the server
 * proves the token first; requests are dispatched only after `ready`.
 */
export class BridgeHandshake {
  private readonly extNonce = randomHex(32);
  private phase: Phase = 'awaiting_challenge';

  constructor(private readonly token: string) {}

  helloFrame(extensionVersion: string): McpBridgeHelloFrame {
    return { type: 'hello', nonce: this.extNonce, extensionVersion };
  }

  isReady(): boolean {
    return this.phase === 'ready';
  }

  async handle(frame: unknown): Promise<HandshakeOutcome> {
    const type = isRecord(frame) ? frame.type : undefined;
    if (this.phase === 'ready') return { kind: type === 'request' ? 'dispatch' : 'ignore' };
    if (type === 'request') return { kind: 'drop' };
    if (this.phase === 'awaiting_challenge') return this.onChallenge(frame);
    if (this.phase === 'awaiting_ready') return this.onReady(frame);
    return { kind: 'fail', reason: 'unexpected frame during handshake' };
  }

  private async onChallenge(frame: unknown): Promise<HandshakeOutcome> {
    this.phase = 'verifying';
    if (!isRecord(frame) || frame.type !== 'challenge') return { kind: 'fail', reason: 'expected challenge' };
    const serverNonce = frame.nonce;
    if (typeof serverNonce !== 'string' || !NONCE_PATTERN.test(serverNonce)) {
      return { kind: 'fail', reason: 'malformed server nonce' };
    }
    const expected = await computeBridgeProof(this.token, MCP_BRIDGE_SERVER_PROOF_LABEL, this.extNonce, serverNonce);
    if (!constantTimeEqual(expected, frame.proof)) return { kind: 'fail', reason: 'server proof mismatch' };
    this.phase = 'awaiting_ready';
    const proof = await computeBridgeProof(this.token, MCP_BRIDGE_CLIENT_PROOF_LABEL, serverNonce, this.extNonce);
    return { kind: 'reply', frame: { type: 'auth', proof } };
  }

  private onReady(frame: unknown): HandshakeOutcome {
    if (!isRecord(frame) || frame.type !== 'ready') return { kind: 'fail', reason: 'expected ready' };
    this.phase = 'ready';
    return { kind: 'ready' };
  }
}
