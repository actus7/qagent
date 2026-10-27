import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Opt-in TypeSafe System One (Jev) integration. Having an API key is the only switch for the client; each
// acceleration feature below has its own flag, is off by default, and falls back to the LLM when Jev is unsure.
export const JEV_FEATURES = ['doneCheck', 'toolRouting', 'plannerSkip', 'pluginRouting', 'elementFastPath'] as const;
export type JevFeature = (typeof JEV_FEATURES)[number];

export type JevFeatureFlags = Record<JevFeature, boolean>;
export type JevThresholds = Record<JevFeature, number>;

export interface JevConfig {
  apiKey: string;
  model: string;
  features: JevFeatureFlags;
  thresholds: JevThresholds;
}

// ponytail: one threshold per feature; Choice confidence and Noul probability are both read against it.
export const DEFAULT_JEV_THRESHOLDS: JevThresholds = {
  doneCheck: 0.85,
  toolRouting: 0.3,
  plannerSkip: 0.85,
  pluginRouting: 0.7,
  elementFastPath: 0.9,
};

const DEFAULT_FEATURE_FLAGS: JevFeatureFlags = {
  doneCheck: false,
  toolRouting: false,
  plannerSkip: false,
  pluginRouting: false,
  elementFastPath: false,
};

export const DEFAULT_JEV_CONFIG: JevConfig = {
  apiKey: '',
  model: 'jev-latest',
  features: DEFAULT_FEATURE_FLAGS,
  thresholds: DEFAULT_JEV_THRESHOLDS,
};

type JevStorage = BaseStorage<JevConfig> & {
  getConfig: () => Promise<JevConfig>;
  updateConfig: (settings: Partial<JevConfig>) => Promise<void>;
};

function sanitizeFeatures(value: unknown): JevFeatureFlags {
  const source = typeof value === 'object' && value !== null ? (value as Partial<Record<JevFeature, unknown>>) : {};
  const features = { ...DEFAULT_FEATURE_FLAGS };
  for (const feature of JEV_FEATURES) {
    features[feature] = source[feature] === true;
  }
  return features;
}

function sanitizeThresholds(value: unknown): JevThresholds {
  const source = typeof value === 'object' && value !== null ? (value as Partial<Record<JevFeature, unknown>>) : {};
  const thresholds = { ...DEFAULT_JEV_THRESHOLDS };
  for (const feature of JEV_FEATURES) {
    const candidate = source[feature];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      thresholds[feature] = Math.min(1, Math.max(0, candidate));
    }
  }
  return thresholds;
}

function sanitize(value: Partial<JevConfig>): JevConfig {
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim().slice(0, 256) : '';
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : DEFAULT_JEV_CONFIG.model;
  return {
    apiKey,
    model,
    features: sanitizeFeatures(value.features),
    thresholds: sanitizeThresholds(value.thresholds),
  };
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
    // Merged inside the write, so two concurrent updates cannot drop each other's changes.
    await storage.set(prev => sanitize({ ...sanitize(prev), ...settings }));
  },
};
