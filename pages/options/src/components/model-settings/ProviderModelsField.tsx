import { t } from '@extension/i18n';
import { ProviderTypeEnum } from '@extension/storage';
import type { KeyboardEvent } from 'react';
import type { ProviderConfig } from '@extension/storage';
import { FIELD_LABEL_CLASS } from './constants';
import { getDefaultModelNames } from './providerUtils';
import { TagListInput } from './TagListInput';

interface ProviderModelsFieldProps {
  providerId: string;
  config: ProviderConfig;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveModel: (model: string) => void;
}

/** Model-name tags for every non-Azure provider. OpenRouter shows an empty-state hint instead of defaults. */
export function ProviderModelsField({
  providerId,
  config,
  inputValue,
  onInputChange,
  onInputKeyDown,
  onRemoveModel,
}: ProviderModelsFieldProps) {
  const isOpenRouter = config.type === ProviderTypeEnum.OpenRouter;
  let models: string[];
  if (isOpenRouter) {
    models = config.modelNames || [];
  } else {
    models = config.modelNames !== undefined ? config.modelNames : getDefaultModelNames(providerId);
  }

  return (
    <div className="flex items-start">
      <label htmlFor={`${providerId}-models-label`} className={`${FIELD_LABEL_CLASS} pt-2`}>
        {t('options_models_providers_models')}
      </label>
      <div className="flex-1 space-y-2">
        <TagListInput
          id={`${providerId}-models-input`}
          tags={models}
          inputValue={inputValue}
          placeholder=""
          emptyText={isOpenRouter ? t('options_models_providers_models_openrouter_empty') : undefined}
          onInputChange={onInputChange}
          onInputKeyDown={onInputKeyDown}
          onRemove={onRemoveModel}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t('options_models_providers_models_instructions')}</p>
      </div>
    </div>
  );
}
