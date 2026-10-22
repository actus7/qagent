import { t } from '@extension/i18n';
import { ProviderTypeEnum } from '@extension/storage';
import { PANEL_CLASS, SECTION_CARD_CLASS, SELECT_CLASS } from './constants';
import { ModelOptions } from './ModelOptions';
import type { AvailableModel, ProviderMap } from './types';

interface SpeechToTextSectionProps {
  selectedModel: string;
  availableModels: AvailableModel[];
  providers: ProviderMap;
  onModelChange: (modelValue: string) => void;
}

/** Speech-to-text card. Only Gemini models are offered. */
export function SpeechToTextSection({
  selectedModel,
  availableModels,
  providers,
  onModelChange,
}: SpeechToTextSectionProps) {
  const geminiModels = availableModels.filter(({ provider }) => providers[provider]?.type === ProviderTypeEnum.Gemini);

  return (
    <div className={SECTION_CARD_CLASS}>
      <h2 className="mb-4 text-left text-xl font-semibold text-foreground">
        {t('options_models_speechToText_header')}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">{t('options_models_stt_desc')}</p>

      <div className={PANEL_CLASS}>
        <div className="flex items-center">
          <label htmlFor="speech-to-text-model" className="w-24 text-sm font-medium text-foreground">
            {t('options_models_labels_model')}
          </label>
          <select
            id="speech-to-text-model"
            className={SELECT_CLASS}
            value={selectedModel}
            onChange={e => onModelChange(e.target.value)}>
            <option value="">{t('options_models_chooseModel')}</option>
            <ModelOptions models={geminiModels} />
          </select>
        </div>
      </div>
    </div>
  );
}
