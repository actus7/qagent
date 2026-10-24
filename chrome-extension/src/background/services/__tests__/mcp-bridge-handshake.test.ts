import { describe, expect, it } from 'vitest';
import { MCP_BRIDGE_CLIENT_PROOF_LABEL, MCP_BRIDGE_SERVER_PROOF_LABEL } from '@extension/shared';
import {
  mcpBridgeProof,
  MCP_BRIDGE_CLIENT_PROOF_LABEL as SERVER_CLIENT_LABEL,
  MCP_BRIDGE_SERVER_PROOF_LABEL as SERVER_SERVER_LABEL,
} from '../../../../../packages/dev-utils/lib/mcp-bridge/bridge';
import { BridgeHandshake, computeBridgeProof, constantTimeEqual } from '../mcpBridge/handshake';

const TOKEN = 'test-token-0123456789-abcdefghijklmnop';
const OTHER_TOKEN = 'another-token-0123456789-abcdefghijk';
const SERVER_NONCE = 'b'.repeat(64);

describe('handshake labels', () => {
  it('keeps the extension and server label constants in sync', () => {
    expect(SERVER_SERVER_LABEL).toBe(MCP_BRIDGE_SERVER_PROOF_LABEL);
    expect(SERVER_CLIENT_LABEL).toBe(MCP_BRIDGE_CLIENT_PROOF_LABEL);
  });
});

describe('HMAC proof helpers', () => {
  it('computes the same proof in WebCrypto (extension) and node:crypto (server)', async () => {
    const extNonce = 'a'.repeat(64);
    const extProof = await computeBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, extNonce, SERVER_NONCE);
    expect(extProof).toBe(mcpBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, extNonce, SERVER_NONCE));
    expect(extProof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails when the token differs', async () => {
    const expected = mcpBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, 'a'.repeat(64), SERVER_NONCE);
    expect(await computeBridgeProof(OTHER_TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, 'a'.repeat(64), SERVER_NONCE)).not.toBe(
      expected,
    );
  });

  it('fails when the nonces are swapped', async () => {
    const first = 'a'.repeat(64);
    const forward = await computeBridgeProof(TOKEN, MCP_BRIDGE_CLIENT_PROOF_LABEL, first, SERVER_NONCE);
    const swapped = await computeBridgeProof(TOKEN, MCP_BRIDGE_CLIENT_PROOF_LABEL, SERVER_NONCE, first);
    expect(swapped).not.toBe(forward);
  });

  it('does not accept a server proof as a client proof (labels bind the direction)', async () => {
    const serverProof = await computeBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, 'a'.repeat(64), SERVER_NONCE);
    const clientProof = await computeBridgeProof(TOKEN, MCP_BRIDGE_CLIENT_PROOF_LABEL, 'a'.repeat(64), SERVER_NONCE);
    expect(clientProof).not.toBe(serverProof);
  });

  it('compares proofs in constant time semantics: equal strings only', () => {
    expect(constantTimeEqual('abcd', 'abcd')).toBe(true);
    expect(constantTimeEqual('abcd', 'abce')).toBe(false);
    expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    expect(constantTimeEqual('abcd', undefined)).toBe(false);
  });
});

describe('BridgeHandshake (extension side)', () => {
  const challengeFor = (extNonce: string, token = TOKEN) => ({
    type: 'challenge',
    nonce: SERVER_NONCE,
    proof: mcpBridgeProof(token, MCP_BRIDGE_SERVER_PROOF_LABEL, extNonce, SERVER_NONCE),
  });

  const request = { type: 'request', id: 'req-1', method: 'get_status', params: {} };

  it('sends a hello with a random nonce and no token', () => {
    const hello = new BridgeHandshake(TOKEN).helloFrame('0.1.13');
    expect(hello).toMatchObject({ type: 'hello', extensionVersion: '0.1.13' });
    expect(hello.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(hello)).not.toContain(TOKEN);
  });

  it('answers a valid challenge with an auth proof and becomes ready only on ready', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    const { nonce: extNonce } = handshake.helloFrame('0.1.13');
    const outcome = await handshake.handle(challengeFor(extNonce));
    expect(outcome).toEqual({
      kind: 'reply',
      frame: {
        type: 'auth',
        proof: mcpBridgeProof(TOKEN, MCP_BRIDGE_CLIENT_PROOF_LABEL, SERVER_NONCE, extNonce),
      },
    });
    expect(handshake.isReady()).toBe(false);

    expect(await handshake.handle({ type: 'ready' })).toEqual({ kind: 'ready' });
    expect(handshake.isReady()).toBe(true);
    expect(await handshake.handle(request)).toEqual({ kind: 'dispatch' });
  });

  it('drops a request that arrives before ready and keeps the handshake going', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    const { nonce: extNonce } = handshake.helloFrame('0.1.13');
    expect(await handshake.handle(request)).toEqual({ kind: 'drop' });
    expect(handshake.isReady()).toBe(false);
    expect((await handshake.handle(challengeFor(extNonce))).kind).toBe('reply');
    expect(await handshake.handle(request)).toEqual({ kind: 'drop' });
    expect(handshake.isReady()).toBe(false);
  });

  it('fails when the server proof does not verify, and never replies with auth', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    const { nonce: extNonce } = handshake.helloFrame('0.1.13');
    const outcome = await handshake.handle(challengeFor(extNonce, OTHER_TOKEN));
    expect(outcome).toMatchObject({ kind: 'fail', reason: 'server proof mismatch' });
    expect(handshake.isReady()).toBe(false);
  });

  it('fails when the server proof was computed with swapped nonces', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    const { nonce: extNonce } = handshake.helloFrame('0.1.13');
    const swapped = {
      type: 'challenge',
      nonce: extNonce,
      proof: mcpBridgeProof(TOKEN, MCP_BRIDGE_SERVER_PROOF_LABEL, SERVER_NONCE, extNonce),
    };
    expect(await handshake.handle(swapped)).toMatchObject({ kind: 'fail' });
  });

  it('fails on a malformed server nonce', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    expect(await handshake.handle({ type: 'challenge', nonce: 'not-hex', proof: 'x' })).toMatchObject({
      kind: 'fail',
      reason: 'malformed server nonce',
    });
  });

  it('fails when ready arrives before the challenge was verified', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    expect(await handshake.handle({ type: 'ready' })).toMatchObject({ kind: 'fail' });
    expect(handshake.isReady()).toBe(false);
  });

  it('fails on any frame that is not the expected handshake step', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    expect(await handshake.handle({ type: 'response', id: '1', ok: true })).toMatchObject({ kind: 'fail' });
  });

  it('ignores non-request frames once ready', async () => {
    const handshake = new BridgeHandshake(TOKEN);
    const { nonce: extNonce } = handshake.helloFrame('0.1.13');
    await handshake.handle(challengeFor(extNonce));
    await handshake.handle({ type: 'ready' });
    expect(await handshake.handle({ type: 'ping' })).toEqual({ kind: 'ignore' });
  });
});
