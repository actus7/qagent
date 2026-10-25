/**
 * Minimal MCP client for remote servers over Streamable HTTP: JSON-RPC 2.0 posted to one endpoint.
 * Uses only fetch, so it runs in the service worker and on extension pages alike.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_REQUEST_TIMEOUT_MS = 20_000;
const MCP_CLIENT_VERSION = '1.0.0';
const MCP_MAX_TOOL_PAGES = 10;

export interface McpEndpoint {
  url: string;
  headers: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolResult {
  text: string;
  isError: boolean;
}

export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpClientError';
  }
}

interface JsonRpcMessage {
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpSession {
  endpoint: McpEndpoint;
  sessionId: string | null;
  initialized: boolean;
  nextId: number;
}

function parseSseMessages(text: string): JsonRpcMessage[] {
  return text.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())
      .join('\n');
    return data ? [parseJson(data)] : [];
  });
}

function parseJson(text: string): JsonRpcMessage {
  try {
    return JSON.parse(text) as JsonRpcMessage;
  } catch {
    throw new McpClientError('MCP server sent invalid JSON');
  }
}

/** One POST. Notifications get no reply body; requests get JSON or an SSE stream, which may hold several messages. */
async function send(session: McpSession, body: object, expectsReply: boolean): Promise<JsonRpcMessage[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(session.endpoint.url, {
      method: 'POST',
      headers: {
        ...session.endpoint.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session.sessionId ? { 'Mcp-Session-Id': session.sessionId } : {}),
        ...(session.initialized ? { 'MCP-Protocol-Version': MCP_PROTOCOL_VERSION } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    session.sessionId = response.headers.get('Mcp-Session-Id') ?? session.sessionId;
    if (!response.ok) throw new McpClientError(`MCP server answered HTTP ${response.status}`);
    if (!expectsReply) return [];

    const text = await response.text();
    if (response.headers.get('Content-Type')?.includes('text/event-stream')) return parseSseMessages(text);
    const parsed = parseJson(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    if (error instanceof McpClientError) throw error;
    if (controller.signal.aborted) throw new McpClientError('MCP server did not answer in time');
    throw new McpClientError(`MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function request(session: McpSession, method: string, params: object): Promise<unknown> {
  const id = session.nextId++;
  const messages = await send(session, { jsonrpc: '2.0', id, method, params }, true);
  const reply = messages.find(message => message.id === id);
  if (!reply) throw new McpClientError(`MCP server sent no reply to ${method}`);
  if (reply.error) throw new McpClientError(reply.error.message);
  return reply.result;
}

/** Runs the handshake: initialize, then the initialized notification. The session id comes from the server. */
async function openSession(endpoint: McpEndpoint): Promise<McpSession> {
  const session: McpSession = { endpoint, sessionId: null, initialized: false, nextId: 1 };
  await request(session, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'QAgent', version: MCP_CLIENT_VERSION },
  });
  session.initialized = true;
  await send(session, { jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  return session;
}

/** Lists the server's tools, following pagination up to a fixed number of pages. */
export async function listMcpTools(endpoint: McpEndpoint): Promise<McpTool[]> {
  const session = await openSession(endpoint);
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MCP_MAX_TOOL_PAGES; page++) {
    const result = (await request(session, 'tools/list', cursor ? { cursor } : {})) as {
      tools?: McpTool[];
      nextCursor?: string;
    } | null;
    tools.push(...(result?.tools ?? []).filter(tool => typeof tool.name === 'string'));
    cursor = result?.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

/** Calls one tool. Text content is returned as text; other content types are named, not decoded. */
export async function callMcpTool(endpoint: McpEndpoint, name: string, args: object): Promise<McpToolResult> {
  const session = await openSession(endpoint);
  const result = (await request(session, 'tools/call', { name, arguments: args })) as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  } | null;
  const text = (result?.content ?? [])
    .map(item => (item.type === 'text' ? (item.text ?? '') : `[${item.type ?? 'unknown'} content]`))
    .join('\n');
  return { text, isError: result?.isError === true };
}
