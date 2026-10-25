import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserPlugin } from '@extension/storage';
import type { AgentContext } from '../../types';
import { createCallPluginToolAction, createListPluginsAction, createSavePluginAction } from '../plugins';

// In-memory stand-in for the plugin store, so the actions run against a real plugin shape without chrome.storage.
const store = vi.hoisted(() => ({ plugins: [] as BrowserPlugin[] }));

vi.mock('@extension/storage', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    browserPluginsStore: {
      getAll: async () => store.plugins,
      getPlugin: async (id: string) => store.plugins.find(plugin => plugin.id === id),
      save: async (plugin: BrowserPlugin) => {
        store.plugins = [...store.plugins.filter(item => item.id !== plugin.id), plugin];
      },
    },
  };
});

const priceTool = {
  name: 'read_title',
  description: 'Read the page title, optionally upper-cased',
  parameters: { upper: { type: 'boolean' as const, required: false } },
  code: 'return args.upper ? document.title.toUpperCase() : document.title;',
};

const storedPlugin: BrowserPlugin = {
  id: 'plugin-1',
  name: 'Title tools',
  description: 'Reads titles',
  version: '1.0.0',
  enabled: true,
  matches: [],
  instructions: '',
  tools: [priceTool],
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
};

function createContext(evaluateScript = vi.fn(async () => ({ ok: true, text: '"QA TARGET"' }))) {
  const emitEvent = vi.fn();
  const page = { evaluateScript };
  const context = {
    emitEvent,
    browserContext: { getCurrentPage: async () => page },
  } as unknown as AgentContext;
  return { context, evaluateScript, emitEvent };
}

beforeEach(() => {
  store.plugins = [storedPlugin];
});

describe('call_plugin_tool action', () => {
  it('runs the tool in the page with the checked args and returns its output', async () => {
    const { context, evaluateScript } = createContext();
    const result = await createCallPluginToolAction(context).call({
      plugin: 'Title tools',
      tool: 'read_title',
      args: { upper: true },
    });

    expect(evaluateScript).toHaveBeenCalledWith(expect.stringContaining('({"upper":true})'));
    expect(evaluateScript).toHaveBeenCalledWith(expect.stringContaining('document.title.toUpperCase()'));
    expect(result.extractedContent).toContain('"QA TARGET"');
    expect(result.error).toBeFalsy();
  });

  it('fails without touching the page when the plugin is missing or disabled', async () => {
    store.plugins = [{ ...storedPlugin, enabled: false }];
    const { context, evaluateScript } = createContext();
    const result = await createCallPluginToolAction(context).call({ plugin: 'plugin-1', tool: 'read_title', args: {} });

    expect(evaluateScript).not.toHaveBeenCalled();
    expect(result.error).toBeTruthy();
  });

  it('fails without touching the page when the args do not match the tool', async () => {
    const { context, evaluateScript } = createContext();
    const result = await createCallPluginToolAction(context).call({
      plugin: 'Title tools',
      tool: 'read_title',
      args: { upper: 'yes' },
    });

    expect(evaluateScript).not.toHaveBeenCalled();
    expect(result.error).toBe('argument "upper" must be a boolean');
  });

  it('reports a thrown error in the page as a result for the agent', async () => {
    const { context } = createContext(vi.fn(async () => ({ ok: false, text: 'ReferenceError: x is not defined' })));
    const result = await createCallPluginToolAction(context).call({
      plugin: 'Title tools',
      tool: 'read_title',
      args: {},
    });

    expect(result.extractedContent).toContain('ReferenceError: x is not defined');
  });
});

describe('list_plugins action', () => {
  it('lists only enabled plugins with their tools', async () => {
    store.plugins = [storedPlugin, { ...storedPlugin, id: 'plugin-2', name: 'Hidden', enabled: false }];
    const { context } = createContext();
    const result = await createListPluginsAction(context).call({});

    expect(result.extractedContent).toContain('Title tools');
    expect(result.extractedContent).toContain('read_title(upper: boolean?)');
    expect(result.extractedContent).not.toContain('Hidden');
  });
});

describe('save_plugin action', () => {
  it('stores a new agent plugin as enabled and returns its id and tools', async () => {
    store.plugins = [];
    const { context } = createContext();
    const result = await createSavePluginAction(context).call({
      plugin: {
        name: 'Price extractor',
        tools: [
          {
            name: 'extract_prices',
            description: 'Extract prices',
            parameters: {},
            code: 'return [...document.querySelectorAll(".price")].map(el => el.textContent);',
          },
        ],
      },
    });

    expect(store.plugins).toHaveLength(1);
    const saved = store.plugins[0];
    expect(saved).toMatchObject({ name: 'Price extractor', enabled: true, createdBy: 'agent' });
    expect(result.extractedContent).toContain(`id: ${saved.id}`);
    expect(result.extractedContent).toContain('tools: extract_prices');
  });

  it("saves an edit of the user's plugin as an agent copy and leaves the original intact", async () => {
    const original = { ...store.plugins.find(plugin => plugin.id === 'plugin-1')! };
    const { context } = createContext();
    await createSavePluginAction(context).call({
      plugin: { id: 'plugin-1', name: 'Title tools v2', tools: [] },
    });

    expect(store.plugins).toHaveLength(2);
    expect(store.plugins.find(plugin => plugin.id === 'plugin-1')).toEqual(original);
    expect(store.plugins.find(plugin => plugin.id !== 'plugin-1')).toMatchObject({
      name: 'Title tools v2',
      createdBy: 'agent',
    });
  });

  it("updates the agent's own plugin in place and keeps it disabled when it was", async () => {
    store.plugins = [
      { ...store.plugins[0], id: 'agent-1', createdBy: 'agent', enabled: false, createdAt: 5, updatedAt: 5 },
    ];
    const { context } = createContext();
    await createSavePluginAction(context).call({ plugin: { id: 'agent-1', name: 'Renamed', tools: [] } });

    expect(store.plugins).toHaveLength(1);
    expect(store.plugins[0]).toMatchObject({ id: 'agent-1', name: 'Renamed', enabled: false, createdAt: 5 });
  });

  it('rejects an invalid plugin with the validation message and stores nothing', async () => {
    store.plugins = [];
    const { context } = createContext();
    const result = await createSavePluginAction(context).call({
      plugin: { name: 'Bad', tools: [{ name: 'BadName', description: 'x', parameters: {}, code: 'return 1;' }] },
    });

    expect(store.plugins).toHaveLength(0);
    expect(result.error).toMatch(/^Invalid plugin: tool "BadName" must be snake_case/);
  });

  it('makes a plugin saved mid-task callable right away', async () => {
    store.plugins = [];
    const evaluateScript = vi.fn(async () => ({ ok: true, text: '42' }));
    const { context } = createContext(evaluateScript);
    await createSavePluginAction(context).call({
      plugin: {
        name: 'Answer',
        tools: [{ name: 'answer', description: 'Returns 42', parameters: {}, code: 'return 42;' }],
      },
    });
    const result = await createCallPluginToolAction(context).call({ plugin: 'Answer', tool: 'answer', args: {} });

    expect(evaluateScript).toHaveBeenCalledOnce();
    expect(result.extractedContent).toContain('42');
  });
});
