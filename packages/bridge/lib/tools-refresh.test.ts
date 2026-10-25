import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTENSION_NOT_CONNECTED_MESSAGE,
  catalogChanged,
  createQaAgentToolHost,
  type ActionCatalogEntry,
  type BridgeRequester,
} from './tools';
import type { McpBridgeMethod } from './protocol';

const CLICK: ActionCatalogEntry = {
  name: 'click',
  description: 'Click an element',
  inputSchema: { type: 'object', properties: {} },
};
const FILL: ActionCatalogEntry = { name: 'fill', description: 'Fill a field', inputSchema: { type: 'object' } };

function requesterWith(catalog: ActionCatalogEntry[] | null): BridgeRequester {
  return {
    async request(method: McpBridgeMethod) {
      if (method === 'list_actions') {
        if (catalog === null) throw new Error('EXTENSION_NOT_CONNECTED: not connected');
        return { actions: catalog };
      }
      throw new Error('EXTENSION_NOT_CONNECTED: not connected');
    },
  };
}

describe('catalogChanged', () => {
  it('reports a change on the first load', () => {
    assert.equal(catalogChanged(null, [CLICK]), true);
  });

  it('reports no change when the same actions come back', () => {
    assert.equal(catalogChanged([CLICK, FILL], [CLICK, FILL]), false);
  });

  it('reports a change when an action is added or removed', () => {
    assert.equal(catalogChanged([CLICK], [CLICK, FILL]), true);
    assert.equal(catalogChanged([CLICK, FILL], [CLICK]), true);
  });
});

describe('tool host refresh', () => {
  it('serves cached page tools before the extension connects', async () => {
    const host = createQaAgentToolHost(requesterWith(null), { cachedCatalog: [CLICK] });
    const names = (await host.listTools()).map(tool => tool.name);
    assert.ok(names.includes('page_click'));
    assert.ok(names.includes('qagent_run_task'));
  });

  it('reports a change and saves the list when the extension answers with new actions', async () => {
    const saved: ActionCatalogEntry[][] = [];
    const host = createQaAgentToolHost(requesterWith([CLICK]), {
      cachedCatalog: [CLICK],
      saveCatalog: entries => saved.push(entries),
    });
    assert.equal(await host.refreshActions(), false);
    assert.equal(saved.length, 0);

    const host2 = createQaAgentToolHost(requesterWith([CLICK, FILL]), {
      cachedCatalog: [CLICK],
      saveCatalog: entries => saved.push(entries),
    });
    assert.equal(await host2.refreshActions(), true);
    assert.deepEqual(saved, [[CLICK, FILL]]);
  });

  it('keeps the last-known list and reports no change when the extension is not connected', async () => {
    const host = createQaAgentToolHost(requesterWith(null), { cachedCatalog: [CLICK] });
    assert.equal(await host.refreshActions(), false);
    const names = (await host.listTools()).map(tool => tool.name);
    assert.ok(names.includes('page_click'));
  });
});

describe('page tools without the extension', () => {
  it('returns a clear error result instead of hanging', async () => {
    const host = createQaAgentToolHost(requesterWith(null), { cachedCatalog: [CLICK] });
    const result = await host.callTool('page_click', { index: 1 });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, EXTENSION_NOT_CONNECTED_MESSAGE);
  });
});
