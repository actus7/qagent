import { t } from '@extension/i18n';
import type { KeyboardEvent } from 'react';
import type { ProviderConfig } from '@extension/storage';
import { FIELD_LABEL_CLASS, TEXT_INPUT_CLASS } from './constants';
import { TagListInput } from './TagListInput';

interface AzureSettingsFieldsProps {
  providerId: string;
  config: ProviderConfig;
  deploymentInput: string;
  onDeploymentInputChange: (value: string) => void;
  onDeploymentKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveDeployment: (deployment: string) => void;
  onApiVersionChange: (value: string) => void;
}

/** Azure-only fields: deployment names (as tags) and the API version. */
export function AzureSettingsFields({
  providerId,
  config,
  deploymentInput,
  onDeploymentInputChange,
  onDeploymentKeyDown,
  onRemoveDeployment,
  onApiVersionChange,
}: AzureSettingsFieldsProps) {
  return (
    <>
      <div className="flex items-start">
        <label htmlFor={`${providerId}-azure-deployment`} className={`${FIELD_LABEL_CLASS} pt-2`}>
          {t('options_models_providers_deployment')}*
        </label>
        <div className="flex-1 space-y-2">
          <TagListInput
            id={`${providerId}-azure-deployment-input`}
            tags={config.azureDeploymentNames || []}
            inputValue={deploymentInput}
            placeholder={t('options_models_providers_placeholders_azureDeployment')}
            onInputChange={onDeploymentInputChange}
            onInputKeyDown={onDeploymentKeyDown}
            onRemove={onRemoveDeployment}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('options_models_providers_deployment_desc')}</p>
        </div>
      </div>

      <div className="flex items-center">
        <label htmlFor={`${providerId}-azure-version`} className={FIELD_LABEL_CLASS}>
          {t('options_models_providers_apiVersion')}*
        </label>
        <input
          id={`${providerId}-azure-version`}
          type="text"
          placeholder={t('options_models_providers_placeholders_azureApiVersion')}
          value={config.azureApiVersion || ''}
          onChange={e => onApiVersionChange(e.target.value)}
          className={`flex-1 ${TEXT_INPUT_CLASS}`}
        />
      </div>
    </>
  );
}
