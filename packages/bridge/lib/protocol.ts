// Wire protocol between the daemon (this package) and the QAgent extension. Keep in sync with
// packages/shared/lib/utils/mcp-bridge-protocol.ts; the extension test suite checks that both agree.
// This package must not import @extension/shared at runtime: it is published on its own.

export const MCP_BRIDGE_DEFAULT_HOST = '127.0.0.1';
export const MCP_BRIDGE_DEFAULT_PORT = 9224;
/** Local control channel for the MCP server, `qagent status` and `qagent stop`. Also loopback only. */
export const CONTROL_DEFAULT_PORT = 9225;
export const MCP_BRIDGE_MIN_TOKEN_LENGTH = 32;

export const MCP_BRIDGE_SERVER_PROOF_LABEL = 'qagent-mcp-bridge/v1/server';
export const MCP_BRIDGE_CLIENT_PROOF_LABEL = 'qagent-mcp-bridge/v1/client';

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

export const CLI_RUNNERS = ['claude', 'codex'] as const;
export type CliRunner = (typeof CLI_RUNNERS)[number];

export interface McpBridgeRequestFrame {
  type: 'request';
  id: string;
  method: McpBridgeMethod | McpBridgeHostMethod;
  params: Record<string, unknown>;
}

export interface McpBridgeErrorBody {
  code: string;
  message: string;
}

export type McpBridgeResponseFrame =
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: McpBridgeErrorBody };

/** One progress step of a CLI agent run, pushed while `run_cli_task` is in flight. */
export interface McpBridgeEventFrame {
  type: 'event';
  taskId: string;
  /** An ExecutionState value such as `act.start`, `act.ok`, `act.fail`. */
  state: string;
  details: string;
}

/** Failure with a stable code; the code, not a stack trace, is what callers and the model see. */
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
