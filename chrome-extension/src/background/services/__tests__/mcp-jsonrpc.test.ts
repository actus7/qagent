import { describe, expect, it } from 'vitest';
import {
  handleJsonRpcPayload,
  parseJsonRpcLine,
  splitFrames,
  type McpToolHost,
} from '../../../../../packages/dev-utils/lib/mcp-bridge/jsonrpc';
import {
  createQaAgentToolHost,
  QAGENT_TOOLS,
  validateRunTaskArgs,
} from '../../../../../packages/dev-utils/lib/mcp-bridge/tools';

const SERVER = { name: 'qagent', version: '0.1.0' };

const noTools: McpToolHost = {
  listTools: () => [],
  callTool: async () => ({ content: [{ type: 'text', text: 'unused' }] }),
};

const rpc = (body: Record<string, unknown>) => ({ jsonrpc: '2.0', ...body });

describe('stdio framing', () => {
  it('returns complete lines and keeps the partial tail for the next chunk', () => {
    const first = splitFrames('{"a":1}\n{"b"');
    expect(first.frames).toEqual(['{"a":1}']);
    const second = splitFrames(`${first.rest}:2}\r\n\n`);
    expect(second.frames).toEqual(['{"b":2}']);
    expect(second.rest).toBe('');
  });

  it('answers invalid JSON with a parse error and a null id', () => {
    const parsed = parseJsonRpcLine('{oops');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response).toMatchObject({ id: null, error: { code: -32700 } });
  });
});

describe('JSON-RPC dispatch', () => {
  it('answers initialize and negotiates a supported protocol version', async () => {
    const response = await handleJsonRpcPayload(
      rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
      noTools,
      SERVER,
    );
    expect(response).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'qagent' } },
    });
  });

  it('falls back to the latest protocol version for unknown requests', async () => {
    const response = await handleJsonRpcPayload(
      rpc({ id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }),
      noTools,
      SERVER,
    );
    expect(response).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
  });

  it('answers ping with an empty result', async () => {
    expect(await handleJsonRpcPayload(rpc({ id: 'p', method: 'ping' }), noTools, SERVER)).toEqual({
      jsonrpc: '2.0',
      id: 'p',
      result: {},
    });
  });

  it('never responds to notifications', async () => {
    expect(await handleJsonRpcPayload(rpc({ method: 'notifications/initialized' }), noTools, SERVER)).toBeNull();
  });

  it('returns method-not-found for unknown requests', async () => {
    const response = await handleJsonRpcPayload(rpc({ id: 3, method: 'resources/list' }), noTools, SERVER);
    expect(response).toMatchObject({ id: 3, error: { code: -32601 } });
  });

  it('rejects malformed messages as invalid requests', async () => {
    expect(await handleJsonRpcPayload({ id: 4 }, noTools, SERVER)).toMatchObject({ id: 4, error: { code: -32600 } });
    expect(await handleJsonRpcPayload([], noTools, SERVER)).toMatchObject({ error: { code: -32600 } });
  });

  it('answers each element of a batch', async () => {
    const responses = await handleJsonRpcPayload(
      [rpc({ id: 1, method: 'ping' }), rpc({ method: 'notifications/initialized' })],
      noTools,
      SERVER,
    );
    expect(responses).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });
});

describe('tools', () => {
  const host = createQaAgentToolHost({ request: async () => ({ ok: true }) });

  it('lists the four QAgent tools with object input schemas', async () => {
    const response = await handleJsonRpcPayload(rpc({ id: 5, method: 'tools/list' }), host, SERVER);
    const names = (response as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } }).result.tools.map(
      tool => tool.name,
    );
    expect(names).toEqual(['qagent_run_task', 'qagent_list_tabs', 'qagent_get_status', 'qagent_cancel_task']);
    for (const tool of QAGENT_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('rejects calls to tools that are not listed', async () => {
    const response = await handleJsonRpcPayload(
      rpc({ id: 6, method: 'tools/call', params: { name: 'qagent_eval', arguments: {} } }),
      host,
      SERVER,
    );
    expect(response).toMatchObject({ id: 6, error: { code: -32602 } });
  });

  it('validates run_task arguments and reports problems as tool errors', () => {
    expect(validateRunTaskArgs({ task: 'Compre um livro' })).toEqual({
      task: 'Compre um livro',
      mode: 'act',
      permission: 'ask',
    });
    expect(() => validateRunTaskArgs({ task: '' })).toThrow('task');
    expect(() => validateRunTaskArgs({ task: 'x', mode: 'shell' })).toThrow('mode');
    expect(() => validateRunTaskArgs({ task: 'x', url: 'javascript:void(0)' })).toThrow('http');
  });

  it('turns a disconnected bridge into an isError tool result', async () => {
    const response = await handleJsonRpcPayload(
      rpc({ id: 7, method: 'tools/call', params: { name: 'qagent_get_status', arguments: {} } }),
      createQaAgentToolHost({
        request: async () => {
          throw new Error('EXTENSION_NOT_CONNECTED: abra o Chrome');
        },
      }),
      SERVER,
    );
    expect(response).toMatchObject({ id: 7, result: { isError: true } });
  });
});
