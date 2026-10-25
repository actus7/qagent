// Wire format between the local MCP server (packages/dev-utils, stdio for MCP clients) and the extension.
// The MCP server listens on loopback; the extension connects as a WebSocket client.
//
// Handshake (mutual, HMAC-SHA256 over the shared token; the raw token never crosses the socket):
//   ext -> srv  hello      { nonce: extNonce }
//   srv -> ext  challenge  { nonce: srvNonce, proof: HMAC(token, SERVER_LABEL|extNonce|srvNonce) }
//   ext -> srv  auth       { proof: HMAC(token, CLIENT_LABEL|srvNonce|extNonce) }
//   srv -> ext  ready
// The extension verifies the server proof before it sends auth, and executes no request before `ready`.
// Keep the label constants in sync with QAgentMcpBridge in packages/dev-utils (it must not import this file).

export const MCP_BRIDGE_DEFAULT_HOST = '127.0.0.1';
export const MCP_BRIDGE_DEFAULT_PORT = 9224;

export const MCP_BRIDGE_SERVER_PROOF_LABEL = 'qagent-mcp-bridge/v1/server';
export const MCP_BRIDGE_CLIENT_PROOF_LABEL = 'qagent-mcp-bridge/v1/client';
export const MCP_BRIDGE_HANDSHAKE_TIMEOUT_MS = 5000;

/** Requests the daemon sends to the extension. */
export const MCP_BRIDGE_METHODS = [
  'run_task',
  'list_tabs',
  'get_status',
  'cancel_task',
  'list_actions',
  'run_action',
] as const;
export type McpBridgeMethod = (typeof MCP_BRIDGE_METHODS)[number];

/** Requests the extension sends to the daemon: host tools for the in-extension agent, and CLI agents. */
export const MCP_BRIDGE_HOST_METHODS = [
  'shell_exec',
  'fs_read',
  'fs_write',
  'fs_list',
  'fs_search',
  'run_cli_task',
  'cancel_cli_task',
] as const;
export type McpBridgeHostMethod = (typeof MCP_BRIDGE_HOST_METHODS)[number];

export const MCP_BRIDGE_CLI_RUNNERS = ['claude', 'codex'] as const;
export type McpBridgeCliRunner = (typeof MCP_BRIDGE_CLI_RUNNERS)[number];

export interface McpBridgeHelloFrame {
  type: 'hello';
  /** 32 random bytes, hex encoded. */
  nonce: string;
  extensionVersion: string;
}

export interface McpBridgeChallengeFrame {
  type: 'challenge';
  /** 32 random bytes, hex encoded. */
  nonce: string;
  proof: string;
}

export interface McpBridgeAuthFrame {
  type: 'auth';
  proof: string;
}

export interface McpBridgeReadyFrame {
  type: 'ready';
}

export interface McpBridgeRequestFrame {
  type: 'request';
  id: string;
  method: McpBridgeMethod | McpBridgeHostMethod;
  params: Record<string, unknown>;
}

/** One step of a CLI agent run, pushed by the daemon while `run_cli_task` is in flight. */
export interface McpBridgeEventFrame {
  type: 'event';
  taskId: string;
  /** An ExecutionState value such as `act.start`, `act.ok`, `act.fail`. */
  state: string;
  details: string;
}

export interface McpBridgeErrorBody {
  code: string;
  message: string;
}

export type McpBridgeResponseFrame =
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: McpBridgeErrorBody };
