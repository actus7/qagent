import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export type PluginParamType = 'string' | 'number' | 'boolean';

export interface PluginParam {
  type: PluginParamType;
  description?: string;
  required?: boolean;
}

export interface PluginTool {
  /** snake_case, unique within the plugin. */
  name: string;
  description: string;
  parameters: Record<string, PluginParam>;
  /** Body of an async function that receives `args` and returns a JSON-serializable value. */
  code: string;
}

export interface BrowserPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  /** URL globs where the plugin is offered to the agent. Empty means every site. */
  matches: string[];
  /** Free-text guidance for the agent, shown on matching pages. */
  instructions: string;
  tools: PluginTool[];
  createdBy: 'user' | 'agent';
  createdAt: number;
  updatedAt: number;
}

export interface BrowserPluginsConfig {
  plugins: BrowserPlugin[];
}

export const PLUGIN_LIMIT = 50;

type BrowserPluginsStorage = BaseStorage<BrowserPluginsConfig> & {
  getAll: () => Promise<BrowserPlugin[]>;
  getPlugin: (id: string) => Promise<BrowserPlugin | undefined>;
  /** Inserts the plugin, or replaces the stored plugin with the same id. */
  save: (plugin: BrowserPlugin) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
};

const DEFAULT_BROWSER_PLUGINS: BrowserPluginsConfig = { plugins: [] };

const storage = createStorage<BrowserPluginsConfig>('browser-plugins', DEFAULT_BROWSER_PLUGINS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const browserPluginsStore: BrowserPluginsStorage = {
  ...storage,
  async getAll() {
    const config = (await storage.get()) || DEFAULT_BROWSER_PLUGINS;
    return config.plugins;
  },
  async getPlugin(id: string) {
    return (await this.getAll()).find(plugin => plugin.id === id);
  },
  async save(plugin: BrowserPlugin) {
    await storage.set(prev => {
      const exists = prev.plugins.some(item => item.id === plugin.id);
      if (!exists && prev.plugins.length >= PLUGIN_LIMIT) {
        throw new Error(`Plugin limit reached (${PLUGIN_LIMIT}). Remove a plugin before adding another.`);
      }
      const plugins = exists
        ? prev.plugins.map(item => (item.id === plugin.id ? plugin : item))
        : [...prev.plugins, plugin];
      return { plugins };
    });
  },
  async remove(id: string) {
    await storage.set(prev => ({ plugins: prev.plugins.filter(plugin => plugin.id !== id) }));
  },
  async setEnabled(id: string, enabled: boolean) {
    await storage.set(prev => ({
      plugins: prev.plugins.map(plugin => (plugin.id === id ? { ...plugin, enabled } : plugin)),
    }));
  },
};
