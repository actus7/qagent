import { describe, expect, it } from 'vitest';
import {
  MCP_BRIDGE_CLIENT_PROOF_LABEL,
  MCP_BRIDGE_HOST_METHODS,
  MCP_BRIDGE_METHODS,
  MCP_BRIDGE_DEFAULT_PORT,
  MCP_BRIDGE_SERVER_PROOF_LABEL,
} from '@extension/shared';
import * as bridge from '../../../../../packages/bridge/lib/protocol';
import { parseBridgeRequest, McpBridgeError } from '../mcpBridge/protocol';

// The daemon package keeps its own copy of the wire constants so it can be published alone.
// These assertions fail when the two copies drift apart.
describe('MCP bridge wire contract', () => {
  it('matches the daemon copy of methods, labels and the default port', () => {
    expect([...MCP_BRIDGE_METHODS]).toEqual([...bridge.MCP_BRIDGE_METHODS]);
    expect([...MCP_BRIDGE_HOST_METHODS]).toEqual([...bridge.MCP_BRIDGE_HOST_METHODS]);
    expect(MCP_BRIDGE_SERVER_PROOF_LABEL).toBe(bridge.MCP_BRIDGE_SERVER_PROOF_LABEL);
    expect(MCP_BRIDGE_CLIENT_PROOF_LABEL).toBe(bridge.MCP_BRIDGE_CLIENT_PROOF_LABEL);
    expect(MCP_BRIDGE_DEFAULT_PORT).toBe(bridge.MCP_BRIDGE_DEFAULT_PORT);
  });
});

describe('parseBridgeRequest for actions', () => {
  const frame = (method: string, params: unknown) => JSON.stringify({ type: 'request', id: 'r1', method, params });

  it('accepts run_action with a lowercase action name, input and tab', () => {
    const parsed = parseBridgeRequest(frame('run_action', { action: 'click', input: { index: 2 }, tabId: 9 }));
    expect(parsed).toEqual({
      id: 'r1',
      method: 'run_action',
      params: { action: 'click', input: { index: 2 }, tabId: 9 },
    });
  });

  it('defaults run_action input to an empty object', () => {
    const parsed = parseBridgeRequest(frame('run_action', { action: 'page_info' }));
    expect(parsed.method === 'run_action' && parsed.params.input).toEqual({});
  });

  it('rejects run_action names that are not plain action names', () => {
    expect(() => parseBridgeRequest(frame('run_action', { action: 'click; rm -rf' }))).toThrow(McpBridgeError);
  });

  it('accepts list_actions only without parameters', () => {
    expect(parseBridgeRequest(frame('list_actions', {})).method).toBe('list_actions');
    expect(() => parseBridgeRequest(frame('list_actions', { extra: true }))).toThrow(McpBridgeError);
  });

  it('refuses host methods sent in the daemon-to-extension direction', () => {
    expect(() => parseBridgeRequest(frame('shell_exec', { command: 'id' }))).toThrow(McpBridgeError);
  });
});
