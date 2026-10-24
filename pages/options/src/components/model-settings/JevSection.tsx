import { useEffect, useState } from 'react';
import { t } from '@extension/i18n';
import { DEFAULT_JEV_CONFIG, jevStore, type JevConfig } from '@extension/storage';
import { PANEL_CLASS, SECTION_CARD_CLASS, TEXT_INPUT_CLASS } from './constants';

/** TypeSafe System One (Jev) card. Saving a key is the only switch: with one the extension uses Jev automatically. */
export function JevSection() {
  const [config, setConfig] = useState<JevConfig>(DEFAULT_JEV_CONFIG);
  const [draft, setDraft] = useState<JevConfig>(DEFAULT_JEV_CONFIG);

  useEffect(() => {
    void jevStore.getConfig().then(loaded => {
      setConfig(loaded);
      setDraft(loaded);
    });
  }, []);

  const save = async () => {
    await jevStore.updateConfig(draft);
    setConfig(await jevStore.getConfig());
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
            onBlur={() => void save()}
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
            onBlur={() => void save()}
            className={`flex-1 ${TEXT_INPUT_CLASS}`}
          />
        </div>
        <p className={`text-sm ${enabled ? 'text-primary' : 'text-muted-foreground'}`} role="status">
          {enabled ? t('options_models_jev_status_on') : t('options_models_jev_status_off')}
        </p>
      </div>
    </div>
  );
}
