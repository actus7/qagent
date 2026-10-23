import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { t } from '@extension/i18n';

type ClampedIntegerKey = 'maxSteps' | 'maxActionsPerStep' | 'maxFailures' | 'planningInterval' | 'minWaitPageLoad';

const clampInteger = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

interface ClampedIntegerInputProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
}

/** Number input that edits a local draft and clamps only on blur or Enter, so the user can type freely. */
const ClampedIntegerInput = ({ id, label, value, min, max, step, onCommit }: ClampedIntegerInputProps) => {
  const [draft, setDraft] = useState(String(value));
  // Adopt external changes (e.g. settings reloaded) during render instead of in an effect.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(String(value));
  }

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampInteger(parsed, min, max);
    setDraft(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            commit();
          }
        }}
        className={`w-20 rounded-md border border-input bg-card px-3 py-2 text-foreground`}
      />
    </>
  );
};

export const GeneralSettings = () => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const loadedSettings = await generalSettingsStore.getSettings();
        if (!active) {
          return;
        }
        setSettings(loadedSettings);
      } catch (error) {
        console.error('Failed to load general settings:', error);
      }
    };

    const unsubscribe = generalSettingsStore.subscribe(() => {
      if (!active) {
        return;
      }
      const snapshot = generalSettingsStore.getSnapshot();
      if (!snapshot) {
        return;
      }
      setSettings(snapshot);
    });

    void loadSettings();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(key: K, value: GeneralSettingsConfig[K]) => {
    setSettings(prevSettings => ({ ...prevSettings, [key]: value }));

    try {
      await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    } catch (error) {
      console.error('Failed to update general setting:', error);
      const latestSettings = await generalSettingsStore.getSettings();
      setSettings(latestSettings);
    }
  };

  const clampedIntegerInput = (key: ClampedIntegerKey, label: string, min: number, max: number, step?: number) => (
    <ClampedIntegerInput
      id={key}
      label={label}
      value={settings[key]}
      min={min}
      max={max}
      step={step}
      onCommit={value => void updateSetting(key, value as GeneralSettingsConfig[ClampedIntegerKey])}
    />
  );

  // The store forces displayHighlights on while vision is enabled, so the toggle is locked in that case
  const isHighlightsLocked = settings.useVision;

  return (
    <section className="space-y-6">
      <div className={`rounded-lg border border-border bg-card p-6 text-left shadow-xs`}>
        <h2 className={`mb-4 text-left text-xl font-semibold text-foreground`}>{t('options_general_header')}</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_maxSteps')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>{t('options_general_maxSteps_desc')}</p>
            </div>
            {clampedIntegerInput('maxSteps', t('options_general_maxSteps'), 1, 100)}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_maxActions')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>{t('options_general_maxActions_desc')}</p>
            </div>
            {clampedIntegerInput('maxActionsPerStep', t('options_general_maxActions'), 1, 50)}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_maxFailures')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>{t('options_general_maxFailures_desc')}</p>
            </div>
            {clampedIntegerInput('maxFailures', t('options_general_maxFailures'), 1, 10)}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_enableVision')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>{t('options_general_enableVision_desc')}</p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="useVision"
                type="checkbox"
                checked={settings.useVision}
                onChange={e => updateSetting('useVision', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="useVision"
                className={`peer h-6 w-11 rounded-full bg-input peer-checked:bg-primary peer-focus:ring-4 peer-focus:ring-ring peer-focus:outline-hidden after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-input after:bg-card after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-card`}>
                <span className="sr-only">{t('options_general_enableVision')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_displayHighlights')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>
                {isHighlightsLocked
                  ? t('options_general_displayHighlights_visionLocked')
                  : t('options_general_displayHighlights_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="displayHighlights"
                type="checkbox"
                checked={settings.displayHighlights}
                disabled={isHighlightsLocked}
                onChange={e => updateSetting('displayHighlights', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="displayHighlights"
                className={`peer h-6 w-11 rounded-full bg-input peer-checked:bg-primary peer-focus:ring-4 peer-focus:ring-ring peer-focus:outline-hidden after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-input after:bg-card after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-card ${isHighlightsLocked ? 'cursor-not-allowed opacity-60' : ''}`}>
                <span className="sr-only">{t('options_general_displayHighlights')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_planningInterval')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>
                {t('options_general_planningInterval_desc')}
              </p>
            </div>
            {clampedIntegerInput('planningInterval', t('options_general_planningInterval'), 1, 20)}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_minWaitPageLoad')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>{t('options_general_minWaitPageLoad_desc')}</p>
            </div>
            <div className="flex items-center space-x-2">
              {clampedIntegerInput('minWaitPageLoad', t('options_general_minWaitPageLoad'), 250, 5000, 50)}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_replayHistoricalTasks')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>
                {t('options_general_replayHistoricalTasks_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="replayHistoricalTasks"
                type="checkbox"
                checked={settings.replayHistoricalTasks}
                onChange={e => updateSetting('replayHistoricalTasks', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="replayHistoricalTasks"
                className={`peer h-6 w-11 rounded-full bg-input peer-checked:bg-primary peer-focus:ring-4 peer-focus:ring-ring peer-focus:outline-hidden after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-input after:bg-card after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-card`}>
                <span className="sr-only">{t('options_general_replayHistoricalTasks')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium text-foreground`}>{t('options_general_notifyOnCompletion')}</h3>
              <p className={`text-sm font-normal text-muted-foreground`}>
                {t('options_general_notifyOnCompletion_desc')}
              </p>
              <button
                type="button"
                className="mt-2 text-sm text-primary underline"
                onClick={() => void sendTestNotification()}>
                {t('options_general_testNotification')}
              </button>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="notifyOnCompletion"
                type="checkbox"
                checked={settings.notifyOnCompletion}
                onChange={e => updateSetting('notifyOnCompletion', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="notifyOnCompletion"
                className={`peer h-6 w-11 rounded-full bg-input peer-checked:bg-primary peer-focus:ring-4 peer-focus:ring-ring peer-focus:outline-hidden after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-input after:bg-card after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-card`}>
                <span className="sr-only">{t('options_general_notifyOnCompletion')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// Shows the same notification the background sends, so the user can check that Chrome displays them.
function sendTestNotification(): Promise<string> {
  return new Promise(resolve => {
    chrome.notifications.create(
      `qagent-test-${Date.now()}`,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon-128.png'),
        title: t('options_general_testNotification_title'),
        message: t('options_general_testNotification_body'),
      },
      id => resolve(id),
    );
  });
}
