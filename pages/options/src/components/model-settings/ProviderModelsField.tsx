import { useState } from 'react';
import { t } from '@extension/i18n';
import { ProviderTypeEnum } from '@extension/storage';
import { Button } from '@extension/ui';
import type { KeyboardEvent } from 'react';
import type { ProviderConfig } from '@extension/storage';
import { FIELD_LABEL_CLASS } from './constants';
import { getDefaultModelNames } from './providerUtils';
import { ModelCatalogPicker } from './ModelCatalogPicker';
import { TagListInput } from './TagListInput';
import { useProviderModelCatalog } from './useProviderModelCatalog';

interface ProviderModelsFieldProps {
  providerId: string;
  config: ProviderConfig;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveModel: (model: string) => void;
  /** Saves the picked models as the provider's modelNames. */
  onConfirmModelNames: (modelNames: string[]) => void;
}

/** Model-name tags for every non-Azure provider, plus a picker for the models the provider lists itself. */
export function ProviderModelsField({
  providerId,
  config,
  inputValue,
  onInputChange,
  onInputKeyDown,
  onRemoveModel,
  onConfirmModelNames,
}: ProviderModelsFieldProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const { state: catalogState, load: loadCatalog } = useProviderModelCatalog(config);
  const isOpenRouter = config.type === ProviderTypeEnum.OpenRouter;
  let models: string[];
  if (isOpenRouter) {
    models = config.modelNames || [];
  } else {
    models = config.modelNames !== undefined ? config.modelNames : getDefaultModelNames(providerId);
  }

  const openPicker = () => {
    setIsPickerOpen(true);
    if (catalogState.status !== 'loading') {
      void loadCatalog();
    }
  };

  const handleConfirm = (modelNames: string[]) => {
    setIsPickerOpen(false);
    onConfirmModelNames(modelNames);
  };

  return (
    <div className="flex items-start">
      <label htmlFor={`${providerId}-models-input`} className={`${FIELD_LABEL_CLASS} pt-2`}>
        {t('options_models_providers_models')}
      </label>
      <div className="flex-1 space-y-2">
        <div className="flex justify-end">
          <Button
            size="compact"
            variant="secondary"
            aria-expanded={isPickerOpen}
            aria-controls={`${providerId}-catalog`}
            onClick={() => (isPickerOpen ? setIsPickerOpen(false) : openPicker())}>
            {t('options_models_catalog_fetchButton')}
          </Button>
        </div>

        {isPickerOpen && (
          <ModelCatalogPicker
            id={`${providerId}-catalog`}
            catalog={catalogState}
            currentModels={models}
            onRetry={() => void loadCatalog()}
            onConfirm={handleConfirm}
            onCancel={() => setIsPickerOpen(false)}
          />
        )}

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
