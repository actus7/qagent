import { afterEach, describe, expect, it, vi } from 'vitest';
import { callMcpTool, listMcpTools, MCP_REQUEST_TIMEOUT_MS, type McpEndpoint } from '@extension/shared';

const endpoint: McpEndpoint = { url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer token-1' } };

interface RpcBody {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

function jsonResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Stubs fetch with a handler that answers each JSON-RPC body; records every request for assertions. */
function stubFetch(handler: (body: RpcBody) => Response) {
  const requests: Array<{ body: RpcBody; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as RpcBody;
      requests.push({ body, headers: init.headers as Record<string, string> });
      return handler(body);
    }),
  );
  return requests;
}

/** Answers the handshake and the given result for every other request. */
function serverAnswering(resultFor: (body: RpcBody) => unknown) {
  return (body: RpcBody): Response => {
    if (body.method === 'initialize') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} }, { 'Mcp-Session-Id': 'session-1' });
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return jsonResponse({ jsonrpc: '2.0', id: body.id, result: resultFor(body) });
  };
}

describe('MCP client over Streamable HTTP', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('runs the handshake, keeps the session id, and lists tools', async () => {
    const requests = stubFetch(
      serverAnswering(() => ({ tools: [{ name: 'search', description: 'Search the index' }] })),
    );

    const tools = await listMcpTools(endpoint);

    expect(tools).toEqual([{ name: 'search', description: 'Search the index' }]);
    expect(requests.map(request => request.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(requests[0].headers['MCP-Protocol-Version']).toBeUndefined();
    expect(requests[2].headers['Mcp-Session-Id']).toBe('session-1');
    expect(requests[2].headers['MCP-Protocol-Version']).toBeDefined();
    expect(requests[2].headers.Authorization).toBe('Bearer token-1');
  });

  it('follows the cursor to the next page of tools', async () => {
    const requests = stubFetch(
      serverAnswering(body =>
        body.params?.cursor === 'page-2'
          ? { tools: [{ name: 'second' }] }
          : { tools: [{ name: 'first' }], nextCursor: 'page-2' },
      ),
    );

    const tools = await listMcpTools(endpoint);

    expect(tools.map(tool => tool.name)).toEqual(['first', 'second']);
    expect(requests.filter(request => request.body.method === 'tools/list')).toHaveLength(2);
  });

  it('reads a tools/call answer delivered as an SSE stream', async () => {
    const sseReply = (id: number) =>
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'Found 3 items' }], isError: false },
      })}\n\n`;
    stubFetch(body => {
      if (body.method === 'tools/call') {
        return new Response(sseReply(body.id ?? 0), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return serverAnswering(() => ({}))(body);
    });

    const result = await callMcpTool(endpoint, 'search', { q: 'x' });

    expect(result).toEqual({ text: 'Found 3 items', isError: false });
  });

  it('reports a JSON-RPC error with the server message', async () => {
    stubFetch(body => {
      if (body.method === 'tools/call') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unknown tool' } });
      }
      return serverAnswering(() => ({}))(body);
    });

    await expect(callMcpTool(endpoint, 'missing', {})).rejects.toThrow('Unknown tool');
  });

  it('rejects an HTTP error status', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));

    await expect(listMcpTools(endpoint)).rejects.toThrow('HTTP 500');
  });

  it('gives up when the server does not answer in time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );

    const pending = listMcpTools(endpoint);
    const assertion = expect(pending).rejects.toThrow('did not answer in time');
    await vi.advanceTimersByTimeAsync(MCP_REQUEST_TIMEOUT_MS);

    await assertion;
  });
});
