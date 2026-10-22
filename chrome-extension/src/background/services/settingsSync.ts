import { analyticsSettingsStore, generalSettingsStore } from '@extension/storage';
import { resolveLocale, t } from '@extension/i18n';
import { createLogger, setVerboseLoggingEnabled } from '../log';
import { analytics } from './analytics';

const logger = createLogger('background');

const syncLanguageFromSettings = async () => {
  try {
    const settings = await generalSettingsStore.getSettings();
    t.devLocale = resolveLocale(settings.language);
    setVerboseLoggingEnabled(settings.chatDebugMode);
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
    t.devLocale = resolveLocale(settings.language);
    setVerboseLoggingEnabled(settings.chatDebugMode);
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
