// Minimal MCP (Model Context Protocol) server core: JSON-RPC 2.0 over newline-delimited stdio.
// Hand-written on purpose: only initialize, ping, tools/list, tools/call and notifications are needed.

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const JSON_RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolHost {
  listTools(): McpToolDefinition[] | Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Splits buffered stdin into complete lines. The trailing partial line is returned as `rest`. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const frames = lines.map(line => line.trim()).filter(line => line.length > 0);
  return { frames, rest };
}

export function parseJsonRpcLine(
  line: string,
): { ok: true; message: unknown } | { ok: false; response: JsonRpcResponse } {
  try {
    return { ok: true, message: JSON.parse(line) };
  } catch {
    return { ok: false, response: jsonRpcError(null, JSON_RPC_ERROR.parse, 'Parse error: invalid JSON') };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(message: Record<string, unknown>): JsonRpcId {
  const id = message.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

async function callToolSafely(host: McpToolHost, name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  try {
    return await host.callTool(name, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool failed';
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

async function handleRequest(
  message: Record<string, unknown>,
  id: JsonRpcId,
  method: string,
  host: McpToolHost,
  server: McpServerInfo,
): Promise<JsonRpcResponse> {
  const params = isRecord(message.params) ? message.params : {};
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, version: server.version },
          ...(server.instructions ? { instructions: server.instructions } : {}),
        },
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: await host.listTools() } };
    case 'tools/call': {
      if (typeof params.name !== 'string') {
        return jsonRpcError(id, JSON_RPC_ERROR.invalidParams, 'tools/call requires a tool name');
      }
      if (!(await host.listTools()).some(tool => tool.name === params.name)) {
        return jsonRpcError(id, JSON_RPC_ERROR.invalidParams, `Unknown tool: ${params.name}`);
      }
      const args = isRecord(params.arguments) ? params.arguments : {};
      const result = await callToolSafely(host, params.name, args);
      return { jsonrpc: '2.0', id, result };
    }
    default:
      return jsonRpcError(id, JSON_RPC_ERROR.methodNotFound, `Method not found: ${method}`);
  }
}

/**
 * Handles one decoded JSON-RPC message. Notifications (no id) never get a response.
 * Returns null when nothing must be written back.
 */
export async function handleJsonRpcMessage(
  message: unknown,
  host: McpToolHost,
  server: McpServerInfo,
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(isRecord(message) ? readId(message) : null, JSON_RPC_ERROR.invalidRequest, 'Invalid Request');
  }
  const isNotification = message.id === undefined;
  if (isNotification) {
    // notifications/initialized and other notifications need no answer.
    return null;
  }
  return handleRequest(message, readId(message), message.method, host, server);
}

/** Batch-aware wrapper: arrays are answered element by element, as older MCP clients may send them. */
export async function handleJsonRpcPayload(
  payload: unknown,
  host: McpToolHost,
  server: McpServerInfo,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (!Array.isArray(payload)) return handleJsonRpcMessage(payload, host, server);
  if (payload.length === 0) return jsonRpcError(null, JSON_RPC_ERROR.invalidRequest, 'Empty batch');
  const responses: JsonRpcResponse[] = [];
  for (const item of payload) {
    const response = await handleJsonRpcMessage(item, host, server);
    if (response) responses.push(response);
  }
  return responses.length > 0 ? responses : null;
}
