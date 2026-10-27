import { analyticsSettingsStore, generalSettingsStore } from '@extension/storage';
import { resolveLocale, t } from '@extension/i18n';
import { createLogger, setVerboseLoggingEnabled } from '../log';
import { analytics } from './analytics';

const logger = createLogger('background');

type LanguageAndLoggingSettings = { language: Parameters<typeof resolveLocale>[0]; chatDebugMode: boolean };

const applyLanguageAndLogging = (settings: LanguageAndLoggingSettings) => {
  t.devLocale = resolveLocale(settings.language);
  setVerboseLoggingEnabled(settings.chatDebugMode);
};

const syncLanguageFromSettings = async () => {
  try {
    applyLanguageAndLogging(await generalSettingsStore.getSettings());
  } catch (error) {
    logger.warning('Failed to load language settings for background i18n', error);
    setVerboseLoggingEnabled(false);
  }
};

// Keeps background i18n/log verbosity and analytics in sync with the stored settings.
export function registerSettingsSync(): void {
  void syncLanguageFromSettings();

  generalSettingsStore.subscribe(() => {
    const settings = generalSettingsStore.getSnapshot();
    if (!settings) {
      return;
    }
    applyLanguageAndLogging(settings);
  });

  // Initialize analytics
  analytics.init().catch(error => {
    logger.error('Failed to initialize analytics:', error);
  });

  // Listen for analytics settings changes
  analyticsSettingsStore.subscribe(() => {
    analytics.updateSettings().catch(error => {
      logger.error('Failed to update analytics settings:', error);
    });
  });
}
