import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actionTools, createQaAgentToolHost, type BridgeRequester } from './tools';
import type { McpBridgeMethod } from './protocol';

const CATALOG = {
  actions: [
    {
      name: 'click',
      description: 'Click an element',
      inputSchema: { type: 'object', properties: { index: { type: 'integer' } } },
    },
    { name: 'page_info', description: 'Page summary', inputSchema: { type: 'object', properties: {} } },
  ],
};

function fakeRequester(
  calls: { method: McpBridgeMethod; params: Record<string, unknown> }[],
  fail = false,
): BridgeRequester {
  return {
    async request(method, params) {
      calls.push({ method, params });
      if (fail) throw new Error('EXTENSION_NOT_CONNECTED: not connected');
      if (method === 'list_actions') return CATALOG;
      return { ok: true, extractedContent: 'done' };
    },
  };
}

describe('action tools', () => {
  it('names click as page_click and keeps page_info as it is', () => {
    const { tools, actionByTool } = actionTools(CATALOG.actions);
    assert.deepEqual(
      tools.map(tool => tool.name),
      ['page_click', 'page_info'],
    );
    assert.equal(actionByTool.get('page_click'), 'click');
    assert.equal(actionByTool.get('page_info'), 'page_info');
  });

  it('adds an optional tabId to every action schema', () => {
    const [click] = actionTools(CATALOG.actions).tools;
    const properties = (click.inputSchema as { properties: Record<string, { type: string }> }).properties;
    assert.equal(properties.tabId.type, 'integer');
    assert.equal(properties.index.type, 'integer');
  });

  it('routes a tool call to run_action with the tab and the action input separated', async () => {
    const calls: { method: McpBridgeMethod; params: Record<string, unknown> }[] = [];
    const host = createQaAgentToolHost(fakeRequester(calls));
    const result = await host.callTool('page_click', { index: 3, tabId: 7 });
    assert.equal(result.isError, undefined);
    const run = calls.find(call => call.method === 'run_action');
    assert.deepEqual(run?.params, { action: 'click', input: { index: 3 }, tabId: 7 });
  });

  it('keeps the static tools and reports bridge failures as tool errors', async () => {
    const calls: { method: McpBridgeMethod; params: Record<string, unknown> }[] = [];
    const host = createQaAgentToolHost(fakeRequester(calls, true));
    const tools = await host.listTools();
    assert.ok(tools.some(tool => tool.name === 'qagent_run_task'));
    assert.ok(!tools.some(tool => tool.name === 'page_click'));
    const result = await host.callTool('qagent_get_status', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /EXTENSION_NOT_CONNECTED/);
  });
});
