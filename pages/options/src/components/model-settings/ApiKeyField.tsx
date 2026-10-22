import { t } from '@extension/i18n';
import { ProviderTypeEnum } from '@extension/storage';
import type { ProviderConfig } from '@extension/storage';
import { FIELD_LABEL_CLASS, TEXT_INPUT_CLASS } from './constants';

interface ApiKeyFieldProps {
  providerId: string;
  config: ProviderConfig;
  isNewProvider: boolean;
  isKeyVisible: boolean;
  onApiKeyChange: (value: string) => void;
  onToggleVisibility: () => void;
}

function getApiKeyPlaceholder(type: ProviderConfig['type']): string {
  if (type === ProviderTypeEnum.CustomOpenAI) return t('options_models_providers_apiKey_placeholder_optional');
  if (type === ProviderTypeEnum.Ollama) return t('options_models_providers_apiKey_placeholder_ollama');
  return t('options_models_providers_apiKey_placeholder_required');
}

function EyeIcon({ isVisible }: { isVisible: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true">
      <title>{isVisible ? t('options_models_providers_apiKey_hide') : t('options_models_providers_apiKey_show')}</title>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {isVisible && <line x1="2" y1="22" x2="22" y2="2" />}
    </svg>
  );
}

/** API key input. Newly added providers get a show/hide toggle and an echo of the key. */
export function ApiKeyField({
  providerId,
  config,
  isNewProvider,
  isKeyVisible,
  onApiKeyChange,
  onToggleVisibility,
}: ApiKeyFieldProps) {
  const isKeyOptional = config.type === ProviderTypeEnum.CustomOpenAI || config.type === ProviderTypeEnum.Ollama;

  return (
    <>
      <div className="flex items-center">
        <label htmlFor={`${providerId}-api-key`} className={FIELD_LABEL_CLASS}>
          {t('options_models_providers_apiKey')}
          {isKeyOptional ? '' : '*'}
        </label>
        <div className="relative flex-1">
          <input
            id={`${providerId}-api-key`}
            type="password"
            placeholder={getApiKeyPlaceholder(config.type)}
            value={config.apiKey || ''}
            onChange={e => onApiKeyChange(e.target.value)}
            className={`w-full ${TEXT_INPUT_CLASS}`}
          />
          {isNewProvider && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={onToggleVisibility}
              aria-label={
                isKeyVisible ? t('options_models_providers_apiKey_hide') : t('options_models_providers_apiKey_show')
              }>
              <EyeIcon isVisible={isKeyVisible} />
            </button>
          )}
        </div>
      </div>

      {isNewProvider && isKeyVisible && config.apiKey && (
        <div className="ml-20 mt-1">
          <p className="break-words font-mono text-sm text-primary">{config.apiKey}</p>
        </div>
      )}
    </>
  );
}
