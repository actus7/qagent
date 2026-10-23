// Wire format between the local MCP server (packages/dev-utils, stdio for MCP clients) and the extension.
// The MCP server listens on loopback; the extension connects as a WebSocket client and sends `hello` first.

export const MCP_BRIDGE_DEFAULT_HOST = '127.0.0.1';
export const MCP_BRIDGE_DEFAULT_PORT = 9224;

export const MCP_BRIDGE_METHODS = ['run_task', 'list_tabs', 'get_status', 'cancel_task'] as const;
export type McpBridgeMethod = (typeof MCP_BRIDGE_METHODS)[number];

export interface McpBridgeHelloFrame {
  type: 'hello';
  token?: string;
  extensionVersion: string;
}

export interface McpBridgeRequestFrame {
  type: 'request';
  id: string;
  method: McpBridgeMethod;
  params: Record<string, unknown>;
}

export interface McpBridgeErrorBody {
  code: string;
  message: string;
}

export type McpBridgeResponseFrame =
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: McpBridgeErrorBody };
