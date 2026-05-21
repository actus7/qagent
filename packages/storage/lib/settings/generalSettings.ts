import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  displayHighlights: boolean;
  minWaitPageLoad: number;
  replayHistoricalTasks: boolean;
  chatDebugMode: boolean;
  language: string;
}

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  maxSteps: 100,
  maxActionsPerStep: 5,
  maxFailures: 3,
  useVision: false,
  useVisionForPlanner: false,
  planningInterval: 3,
  displayHighlights: false,
  minWaitPageLoad: 250,
  replayHistoricalTasks: false,
  chatDebugMode: false,
  language: 'auto',
};

const GENERAL_SETTINGS_LIMITS = {
  maxSteps: { min: 1, max: 100 },
  maxActionsPerStep: { min: 1, max: 50 },
  maxFailures: { min: 1, max: 10 },
  planningInterval: { min: 1, max: 20 },
  minWaitPageLoad: { min: 250, max: 5000 },
} as const;

function sanitizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.round(value);
  return Math.min(max, Math.max(min, normalized));
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeLanguage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeGeneralSettings(
  settings: Partial<GeneralSettingsConfig>,
  fallback: GeneralSettingsConfig,
): GeneralSettingsConfig {
  const merged = { ...fallback, ...settings };
  const sanitized: GeneralSettingsConfig = {
    maxSteps: sanitizeInteger(
      merged.maxSteps,
      fallback.maxSteps,
      GENERAL_SETTINGS_LIMITS.maxSteps.min,
      GENERAL_SETTINGS_LIMITS.maxSteps.max,
    ),
    maxActionsPerStep: sanitizeInteger(
      merged.maxActionsPerStep,
      fallback.maxActionsPerStep,
      GENERAL_SETTINGS_LIMITS.maxActionsPerStep.min,
      GENERAL_SETTINGS_LIMITS.maxActionsPerStep.max,
    ),
    maxFailures: sanitizeInteger(
      merged.maxFailures,
      fallback.maxFailures,
      GENERAL_SETTINGS_LIMITS.maxFailures.min,
      GENERAL_SETTINGS_LIMITS.maxFailures.max,
    ),
    useVision: sanitizeBoolean(merged.useVision, fallback.useVision),
    useVisionForPlanner: sanitizeBoolean(merged.useVisionForPlanner, fallback.useVisionForPlanner),
    planningInterval: sanitizeInteger(
      merged.planningInterval,
      fallback.planningInterval,
      GENERAL_SETTINGS_LIMITS.planningInterval.min,
      GENERAL_SETTINGS_LIMITS.planningInterval.max,
    ),
    displayHighlights: sanitizeBoolean(merged.displayHighlights, fallback.displayHighlights),
    minWaitPageLoad: sanitizeInteger(
      merged.minWaitPageLoad,
      fallback.minWaitPageLoad,
      GENERAL_SETTINGS_LIMITS.minWaitPageLoad.min,
      GENERAL_SETTINGS_LIMITS.minWaitPageLoad.max,
    ),
    replayHistoricalTasks: sanitizeBoolean(merged.replayHistoricalTasks, fallback.replayHistoricalTasks),
    chatDebugMode: sanitizeBoolean(merged.chatDebugMode, fallback.chatDebugMode),
    language: sanitizeLanguage(merged.language, fallback.language),
  };

  // If useVision is true, displayHighlights must also be true.
  if (sanitized.useVision && !sanitized.displayHighlights) {
    sanitized.displayHighlights = true;
  }

  return sanitized;
}

const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = sanitizeGeneralSettings(await storage.get(), DEFAULT_GENERAL_SETTINGS);
    const updatedSettings = sanitizeGeneralSettings({ ...currentSettings, ...settings }, currentSettings);
    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return sanitizeGeneralSettings(settings, DEFAULT_GENERAL_SETTINGS);
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
