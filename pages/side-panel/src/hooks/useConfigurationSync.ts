import { useCallback, useEffect, useRef } from 'react';
import { agentModelStore, generalSettingsStore } from '@extension/storage';
import { useSidePanelActions } from './useSidePanelSelectors';

const SETTINGS_REFRESH_THROTTLE_MS = 750;

/** Keeps model configuration and general settings in sync with storage and the browser lifecycle. */
export const useConfigurationSync = (hasConfiguredModels: boolean | null) => {
  const { setHasConfiguredModels, setShowSetupRequiredModal, setReplayEnabled, setChatDebugMode } =
    useSidePanelActions();
  const lastSettingsRefreshRef = useRef<number>(0);

  const checkModelConfiguration = useCallback(async () => {
    try {
      const configuredAgents = await agentModelStore.getConfiguredAgents();

      // Check if at least one agent (preferably Navigator) is configured
      const hasAtLeastOneModel = configuredAgents.length > 0;
      setHasConfiguredModels(hasAtLeastOneModel);
    } catch (error) {
      console.error('Error checking model configuration:', error);
      setHasConfiguredModels(false);
    }
  }, [setHasConfiguredModels]);

  // Load general settings to check if replay is enabled
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
      setChatDebugMode(settings.chatDebugMode);
    } catch (error) {
      console.error('Error loading general settings:', error);
      setReplayEnabled(false);
      setChatDebugMode(false);
    }
  }, [setChatDebugMode, setReplayEnabled]);

  const refreshConfigurationAndSettings = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastSettingsRefreshRef.current < SETTINGS_REFRESH_THROTTLE_MS) {
        return;
      }

      lastSettingsRefreshRef.current = now;
      await Promise.all([checkModelConfiguration(), loadGeneralSettings()]);
    },
    [checkModelConfiguration, loadGeneralSettings],
  );

  const handleChatDebugModeChange = useCallback(
    async (enabled: boolean) => {
      setChatDebugMode(enabled);
      try {
        await generalSettingsStore.updateSettings({ chatDebugMode: enabled });
      } catch (error) {
        console.error('Failed to update chat debug mode:', error);
        setChatDebugMode(!enabled);
      }
    },
    [setChatDebugMode],
  );

  // Check model configuration on mount
  useEffect(() => {
    void refreshConfigurationAndSettings(true);
  }, [refreshConfigurationAndSettings]);

  // React immediately to model configuration changes made in other extension pages (e.g. Options).
  useEffect(() => {
    const unsubscribe = agentModelStore.subscribe(() => {
      void checkModelConfiguration();
    });
    return unsubscribe;
  }, [checkModelConfiguration]);

  useEffect(() => {
    if (hasConfiguredModels === true) setShowSetupRequiredModal(false);
  }, [hasConfiguredModels, setShowSetupRequiredModal]);

  // Re-check model configuration when the side panel becomes visible again
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (!document.hidden) {
        void refreshConfigurationAndSettings();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [refreshConfigurationAndSettings]);

  return { handleChatDebugModeChange };
};
