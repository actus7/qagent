import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Opt-in TypeSafe System One (Jev) integration. Having an API key is the only switch: with a key the
// extension uses Jev for fast typed decisions, without one it falls back to the built-in heuristics.
export interface JevConfig {
  apiKey: string;
  model: string;
}

export const DEFAULT_JEV_CONFIG: JevConfig = { apiKey: '', model: 'jev-latest' };

type JevStorage = BaseStorage<JevConfig> & {
  getConfig: () => Promise<JevConfig>;
  updateConfig: (settings: Partial<JevConfig>) => Promise<void>;
};

function sanitize(value: Partial<JevConfig>): JevConfig {
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim().slice(0, 256) : '';
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : DEFAULT_JEV_CONFIG.model;
  return { apiKey, model };
}

const storage = createStorage<JevConfig>('jev-settings', DEFAULT_JEV_CONFIG, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const jevStore: JevStorage = {
  ...storage,
  async getConfig() {
    return sanitize((await storage.get()) ?? DEFAULT_JEV_CONFIG);
  },
  async updateConfig(settings: Partial<JevConfig>) {
    const current = await this.getConfig();
    await storage.set(sanitize({ ...current, ...settings }));
  },
};
