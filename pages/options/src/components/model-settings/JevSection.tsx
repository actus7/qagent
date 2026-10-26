import { useEffect, useState } from 'react';
import { t } from '@extension/i18n';
import {
  DEFAULT_JEV_CONFIG,
  DEFAULT_JEV_THRESHOLDS,
  JEV_FEATURES,
  jevStore,
  type JevConfig,
  type JevFeature,
} from '@extension/storage';
import { PANEL_CLASS, SECTION_CARD_CLASS, TEXT_INPUT_CLASS } from './constants';

const FEATURE_LABEL_KEYS = {
  doneCheck: 'options_models_jev_feature_doneCheck',
  toolRouting: 'options_models_jev_feature_toolRouting',
  plannerSkip: 'options_models_jev_feature_plannerSkip',
  pluginRouting: 'options_models_jev_feature_pluginRouting',
  elementFastPath: 'options_models_jev_feature_elementFastPath',
} as const;

const FEATURE_HELP_KEYS = {
  doneCheck: 'options_models_jev_feature_doneCheck_help',
  toolRouting: 'options_models_jev_feature_toolRouting_help',
  plannerSkip: 'options_models_jev_feature_plannerSkip_help',
  pluginRouting: 'options_models_jev_feature_pluginRouting_help',
  elementFastPath: 'options_models_jev_feature_elementFastPath_help',
} as const;

/** The two boldest options act on page content without the LLM, so they are marked as such. */
const BOLD_FEATURES: readonly JevFeature[] = ['elementFastPath'];

/** Key and model card, plus the opt-in acceleration switches. Each switch only applies when a key is saved. */
export function JevSection() {
  const [config, setConfig] = useState<JevConfig>(DEFAULT_JEV_CONFIG);
  const [draft, setDraft] = useState<JevConfig>(DEFAULT_JEV_CONFIG);

  useEffect(() => {
    void jevStore.getConfig().then(loaded => {
      setConfig(loaded);
      setDraft(loaded);
    });
  }, []);

  // Only the key and the model are edited here; saving the whole draft would overwrite newer switch values.
  const saveKeyAndModel = async () => {
    await jevStore.updateConfig({ apiKey: draft.apiKey, model: draft.model });
    setConfig(await jevStore.getConfig());
  };

  const setFeature = async (feature: JevFeature, on: boolean) => {
    await jevStore.updateConfig({ features: { ...config.features, [feature]: on } });
    setConfig(await jevStore.getConfig());
  };

  const saveThresholds = async () => {
    await jevStore.updateConfig({ thresholds: config.thresholds });
    setConfig(await jevStore.getConfig());
  };

  const changeThreshold = (feature: JevFeature, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setConfig({ ...config, thresholds: { ...config.thresholds, [feature]: parsed } });
  };

  const enabled = config.apiKey.length > 0;

  return (
    <div className={SECTION_CARD_CLASS}>
      <h2 className="mb-1 text-left text-xl font-semibold text-foreground">{t('options_models_jev_header')}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t('options_models_jev_desc')}</p>

      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex items-center gap-3">
          <label htmlFor="jev-api-key" className="w-24 text-sm font-medium text-foreground">
            {t('options_models_jev_apiKey')}
          </label>
          <input
            id="jev-api-key"
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            onChange={e => setDraft({ ...draft, apiKey: e.target.value })}
            onBlur={() => void saveKeyAndModel()}
            className={`flex-1 ${TEXT_INPUT_CLASS}`}
          />
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="jev-model" className="w-24 text-sm font-medium text-foreground">
            {t('options_models_labels_model')}
          </label>
          <input
            id="jev-model"
            type="text"
            value={draft.model}
            onChange={e => setDraft({ ...draft, model: e.target.value })}
            onBlur={() => void saveKeyAndModel()}
            className={`flex-1 ${TEXT_INPUT_CLASS}`}
          />
        </div>
        <p className={`text-sm ${enabled ? 'text-primary' : 'text-muted-foreground'}`} role="status">
          {enabled ? t('options_models_jev_status_on') : t('options_models_jev_status_off')}
        </p>
      </div>

      <fieldset className={`${PANEL_CLASS} mt-4 space-y-4`} disabled={!enabled}>
        <legend className="mb-1 text-left text-base font-semibold text-foreground">
          {t('options_models_jev_accel_header')}
        </legend>
        <p className="text-sm text-muted-foreground">{t('options_models_jev_accel_desc')}</p>
        <p className="text-sm font-medium text-destructive">{t('options_models_jev_accel_warning')}</p>

        {JEV_FEATURES.map(feature => {
          const on = config.features[feature];
          return (
            <div key={feature} className="space-y-1 border-t border-border pt-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={on}
                  onChange={e => void setFeature(feature, e.target.checked)}
                />
                <span className="text-sm">
                  <span className="font-medium text-foreground">{t(FEATURE_LABEL_KEYS[feature])}</span>
                  {BOLD_FEATURES.includes(feature) && (
                    <span className="ml-2 text-xs font-medium text-destructive">
                      {t('options_models_jev_accel_bold')}
                    </span>
                  )}
                  <span className="block text-muted-foreground">{t(FEATURE_HELP_KEYS[feature])}</span>
                </span>
              </label>
              {on && (
                <div className="flex items-center gap-3 pl-7">
                  <label htmlFor={`jev-threshold-${feature}`} className="text-sm text-foreground">
                    {t('options_models_jev_threshold')}
                  </label>
                  <input
                    id={`jev-threshold-${feature}`}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={config.thresholds[feature]}
                    onChange={e => changeThreshold(feature, e.target.value)}
                    onBlur={() => void saveThresholds()}
                    className={`w-24 ${TEXT_INPUT_CLASS}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {`${t('options_models_jev_threshold_default')} ${DEFAULT_JEV_THRESHOLDS[feature]}. ${t('options_models_jev_threshold_help')}`}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}
