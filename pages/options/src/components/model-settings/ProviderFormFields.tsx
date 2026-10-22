import { t } from '@extension/i18n';
import { ProviderTypeEnum } from '@extension/storage';
import type { ProviderConfig } from '@extension/storage';
import { FIELD_LABEL_CLASS, TEXT_INPUT_CLASS } from './constants';
import { ApiKeyField } from './ApiKeyField';
import { AzureSettingsFields } from './AzureSettingsFields';
import { ProviderModelsField } from './ProviderModelsField';
import { requiresBaseUrl } from './providerUtils';
import type { ProviderSettings } from './useProviderSettings';

interface ProviderFormFieldsProps {
  providerId: string;
  config: ProviderConfig;
  isNewProvider: boolean;
  settings: ProviderSettings;
}

function CustomNameField({
  providerId,
  config,
  error,
  onChange,
}: {
  providerId: string;
  config: ProviderConfig;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center">
        <label htmlFor={`${providerId}-name`} className={FIELD_LABEL_CLASS}>
          {t('options_models_providers_custom_name')}
        </label>
        <input
          id={`${providerId}-name`}
          type="text"
          placeholder={t('options_models_providers_custom_name_placeholder')}
          value={config.name || ''}
          onChange={e => onChange(e.target.value)}
          className={`flex-1 rounded-md border p-2 text-sm ${
            error
              ? 'border-border bg-muted focus:border-border focus:ring-2 focus:ring-destructive'
              : 'border-border bg-muted focus:border-border focus:ring-2 focus:ring-ring'
          } outline-none`}
        />
      </div>
      {error ? (
        <p className="ml-20 mt-1 text-xs text-destructive">{error}</p>
      ) : (
        <p className="ml-20 mt-1 text-xs text-muted-foreground">{t('options_models_providers_custom_name_desc')}</p>
      )}
    </div>
  );
}

function getBaseUrlPlaceholder(type: ProviderConfig['type']): string {
  switch (type) {
    case ProviderTypeEnum.CustomOpenAI:
      return t('options_models_providers_placeholders_baseUrl_custom');
    case ProviderTypeEnum.AzureOpenAI:
      return t('options_models_providers_placeholders_baseUrl_azure');
    case ProviderTypeEnum.OpenRouter:
      return t('options_models_providers_placeholders_baseUrl_openrouter');
    case ProviderTypeEnum.Llama:
      return t('options_models_providers_placeholders_baseUrl_llama');
    default:
      return t('options_models_providers_placeholders_baseUrl_ollama');
  }
}

function BaseUrlField({
  providerId,
  config,
  onChange,
}: {
  providerId: string;
  config: ProviderConfig;
  onChange: (value: string) => void;
}) {
  const isAzure = config.type === ProviderTypeEnum.AzureOpenAI;
  const isRequired = config.type === ProviderTypeEnum.CustomOpenAI || isAzure;

  return (
    <div className="flex flex-col">
      <div className="flex items-center">
        <label htmlFor={`${providerId}-base-url`} className={FIELD_LABEL_CLASS}>
          {isAzure ? t('options_models_providers_endpoint') : t('options_models_providers_baseUrl')}
          {isRequired ? '*' : ''}
        </label>
        <input
          id={`${providerId}-base-url`}
          type="text"
          placeholder={getBaseUrlPlaceholder(config.type)}
          value={config.baseUrl || ''}
          onChange={e => onChange(e.target.value)}
          className={`flex-1 ${TEXT_INPUT_CLASS}`}
        />
      </div>
    </div>
  );
}

function OllamaReminder() {
  return (
    <div className="mt-4 rounded-md border border-border bg-muted p-3">
      <p className="text-sm text-foreground">
        <strong>
          {' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm italic">
            OLLAMA_ORIGINS=chrome-extension://*
          </code>{' '}
        </strong>
        {t('options_models_providers_ollama_reminder')}
        <a
          href="https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-allow-additional-web-origins-to-access-ollama"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-primary hover:text-primary">
          {t('options_models_providers_ollama_learnMore')}
        </a>
      </p>
    </div>
  );
}

/** Editable fields of one provider card. Which fields appear depends on the provider type. */
export function ProviderFormFields({ providerId, config, isNewProvider, settings }: ProviderFormFieldsProps) {
  const isAzure = config.type === ProviderTypeEnum.AzureOpenAI;
  const newModelInput = settings.newModelInputs[providerId] || '';

  return (
    <div className="space-y-3">
      {config.type === ProviderTypeEnum.CustomOpenAI && (
        <CustomNameField
          providerId={providerId}
          config={config}
          error={settings.nameErrors[providerId]}
          onChange={value => settings.handleNameChange(providerId, value)}
        />
      )}

      <ApiKeyField
        providerId={providerId}
        config={config}
        isNewProvider={isNewProvider}
        isKeyVisible={Boolean(settings.visibleApiKeys[providerId])}
        onApiKeyChange={value => settings.handleApiKeyChange(providerId, value, config.baseUrl)}
        onToggleVisibility={() => settings.toggleApiKeyVisibility(providerId)}
      />

      {requiresBaseUrl(config.type) && (
        <BaseUrlField
          providerId={providerId}
          config={config}
          onChange={value => settings.handleApiKeyChange(providerId, config.apiKey || '', value)}
        />
      )}

      {isAzure ? (
        <AzureSettingsFields
          providerId={providerId}
          config={config}
          deploymentInput={newModelInput}
          onDeploymentInputChange={value => settings.handleModelsChange(providerId, value)}
          onDeploymentKeyDown={event => settings.handleAzureDeploymentKeyDown(event, providerId)}
          onRemoveDeployment={deployment => settings.removeAzureDeployment(providerId, deployment)}
          onApiVersionChange={value => settings.handleAzureApiVersionChange(providerId, value)}
        />
      ) : (
        <ProviderModelsField
          providerId={providerId}
          config={config}
          inputValue={newModelInput}
          onInputChange={value => settings.handleModelsChange(providerId, value)}
          onInputKeyDown={event => settings.handleModelInputKeyDown(event, providerId)}
          onRemoveModel={model => settings.removeModel(providerId, model)}
        />
      )}

      {config.type === ProviderTypeEnum.Ollama && <OllamaReminder />}
    </div>
  );
}
