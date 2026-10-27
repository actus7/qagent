import { t } from '@extension/i18n';
import { ProviderTypeEnum, getDefaultDisplayNameFromProviderId, llmProviderModelNames } from '@extension/storage';
import type { ProviderConfig } from '@extension/storage';
import { BASE_URL_PROVIDER_TYPES } from './constants';
import type { AvailableModel, ListField, ProviderMap } from './types';

type ProviderSaveError = 'spacesInName' | 'baseUrlRequired' | 'invalidBaseUrl' | 'insecureBaseUrl' | 'noModels';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function getDefaultModelNames(providerId: string): string[] {
  return llmProviderModelNames[providerId as keyof typeof llmProviderModelNames] || [];
}

export function buildAvailableModels(storedProviders: ProviderMap): AvailableModel[] {
  return Object.entries(storedProviders).flatMap(([provider, config]) => {
    const providerName = config.name || provider;
    if (config.type === ProviderTypeEnum.AzureOpenAI) {
      return (config.azureDeploymentNames || []).map(deployment => ({ provider, providerName, model: deployment }));
    }
    const models = config.modelNames || getDefaultModelNames(provider);
    return models.map(model => ({ provider, providerName, model }));
  });
}

/** Mirrors the original rule: custom/ollama/openrouter/llama/azure each need specific fields. */
function hasRequiredSaveInputs(config: ProviderConfig | undefined): boolean {
  const hasApiKey = Boolean(config?.apiKey?.trim());
  const hasBaseUrl = Boolean(config?.baseUrl?.trim());
  switch (config?.type) {
    case ProviderTypeEnum.CustomOpenAI:
    case ProviderTypeEnum.Ollama:
      return hasBaseUrl;
    case ProviderTypeEnum.AzureOpenAI:
      return (
        hasApiKey &&
        hasBaseUrl &&
        Boolean(config?.azureDeploymentNames?.length) &&
        Boolean(config?.azureApiVersion?.trim())
      );
    case ProviderTypeEnum.OpenRouter:
    case ProviderTypeEnum.Llama:
      return hasApiKey && hasBaseUrl;
    default:
      return hasApiKey;
  }
}

export function getProviderActionState(
  config: ProviderConfig,
  isInStorage: boolean,
  isModified: boolean,
): { isDelete: boolean; variant: 'destructive' | 'default'; label: string; disabled: boolean } {
  if (isInStorage && !isModified) {
    return {
      isDelete: true,
      variant: 'destructive',
      label: t('options_models_providers_btnDelete'),
      disabled: false,
    };
  }
  return {
    isDelete: false,
    variant: 'default',
    label: t('options_models_providers_btnSave'),
    disabled: !hasRequiredSaveInputs(config) || !isModified,
  };
}

export function requiresBaseUrl(type: ProviderTypeEnum | undefined): boolean {
  return type !== undefined && BASE_URL_PROVIDER_TYPES.includes(type);
}

/** Only http(s) is allowed; plain http is limited to local servers such as Ollama. */
function getBaseUrlSaveError(baseUrl: string): 'invalidBaseUrl' | 'insecureBaseUrl' | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'invalidBaseUrl';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'invalidBaseUrl';
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTNAMES.has(url.hostname)) {
    return 'insecureBaseUrl';
  }
  return null;
}

export function getProviderSaveError(config: ProviderConfig): ProviderSaveError | null {
  if (config.type === ProviderTypeEnum.CustomOpenAI && config.name?.includes(' ')) {
    return 'spacesInName';
  }
  if (requiresBaseUrl(config.type) && !config.baseUrl?.trim()) {
    return 'baseUrlRequired';
  }
  if (config.baseUrl?.trim()) {
    const urlError = getBaseUrlSaveError(config.baseUrl.trim());
    if (urlError) {
      return urlError;
    }
  }
  const hasModels =
    config.type === ProviderTypeEnum.AzureOpenAI
      ? Boolean(config.azureDeploymentNames?.length)
      : Boolean(config.modelNames?.length);
  if (!hasModels) {
    return 'noModels';
  }
  return null;
}

export function getProviderSaveErrorMessage(error: ProviderSaveError, providerId: string): string {
  switch (error) {
    case 'spacesInName':
      return t('options_models_providers_errors_spacesNotAllowed');
    case 'baseUrlRequired':
      return t('options_models_providers_errors_baseUrlRequired', getDefaultDisplayNameFromProviderId(providerId));
    case 'invalidBaseUrl':
      return t('options_models_providers_errors_invalidBaseUrl');
    case 'insecureBaseUrl':
      return t('options_models_providers_errors_insecureBaseUrl');
    case 'noModels':
      return t('options_models_providers_errors_noModels');
  }
}

/** Appends a tag-input value that was typed but not committed (Enter/Space), so Save never drops it. */
export function withPendingEntry(
  providerId: string,
  config: ProviderConfig | undefined,
  pendingValue: string | undefined,
): ProviderConfig | undefined {
  const value = pendingValue?.trim();
  if (!config || !value) {
    return config;
  }
  const isAzure = config.type === ProviderTypeEnum.AzureOpenAI;
  const field = isAzure ? 'azureDeploymentNames' : 'modelNames';
  const fallback = isAzure ? [] : getDefaultModelNames(providerId);
  return addToListField({ [providerId]: config }, providerId, field, value, fallback)[providerId];
}

/** Builds the payload for llmProviderStore.setProvider. Azure never stores modelNames. */
export function buildProviderConfigToSave(providerId: string, config: ProviderConfig): ProviderConfig {
  const configToSave: Partial<ProviderConfig> = {
    ...config,
    apiKey: config.apiKey || '',
    name: config.name || getDefaultDisplayNameFromProviderId(providerId),
    type: config.type,
    createdAt: config.createdAt || Date.now(),
    modelNames:
      config.type === ProviderTypeEnum.AzureOpenAI ? undefined : config.modelNames || getDefaultModelNames(providerId),
  };
  return configToSave as ProviderConfig;
}

export function getNextCustomProviderNumber(providers: ProviderMap): number {
  let maxNumber = 0;
  for (const providerId of Object.keys(providers)) {
    if (providerId.startsWith('custom_openai_')) {
      const match = providerId.match(/custom_openai_(\d+)/);
      if (match) {
        maxNumber = Math.max(maxNumber, Number.parseInt(match[1], 10));
      }
    }
  }
  return maxNumber + 1;
}

export function getNextAzureProviderId(providers: ProviderMap): { providerId: string; nextNumber: number } {
  let maxNumber = 0;
  for (const providerId of Object.keys(providers)) {
    if (providerId === ProviderTypeEnum.AzureOpenAI) {
      maxNumber = Math.max(maxNumber, 1);
    } else if (providerId.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`)) {
      const match = providerId.match(/_(\d+)$/);
      if (match) {
        maxNumber = Math.max(maxNumber, Number.parseInt(match[1], 10));
      }
    }
  }
  const nextNumber = maxNumber + 1;
  const providerId = nextNumber === 1 ? ProviderTypeEnum.AzureOpenAI : `${ProviderTypeEnum.AzureOpenAI}_${nextNumber}`;
  return { providerId, nextNumber };
}

/** Appends a trimmed value to a list field unless it is already present. Returns the same object when nothing changes. */
export function addToListField(
  providers: ProviderMap,
  provider: string,
  field: ListField,
  value: string,
  fallback: string[],
): ProviderMap {
  const providerData: Partial<ProviderConfig> = providers[provider] || {};
  const current = providerData[field] ?? fallback;
  if (current.includes(value)) {
    return providers;
  }
  return { ...providers, [provider]: { ...providerData, [field]: [...current, value] } as ProviderConfig };
}

export function removeFromListField(
  providers: ProviderMap,
  provider: string,
  field: ListField,
  value: string,
  fallback: string[],
): ProviderMap {
  const providerData: Partial<ProviderConfig> = providers[provider] || {};
  const current = providerData[field] ?? fallback;
  return {
    ...providers,
    [provider]: { ...providerData, [field]: current.filter(item => item !== value) } as ProviderConfig,
  };
}

function compareProviderEntries(
  [keyA, configA]: [string, ProviderConfig],
  [keyB, configB]: [string, ProviderConfig],
  providersFromStorage: Set<string>,
  modifiedProviders: Set<string>,
): number {
  // Newly added (unsaved) providers go to the end
  const isNewA = !providersFromStorage.has(keyA) && modifiedProviders.has(keyA);
  const isNewB = !providersFromStorage.has(keyB) && modifiedProviders.has(keyB);
  if (isNewA && !isNewB) return 1;
  if (!isNewA && isNewB) return -1;

  // Oldest first when both have createdAt; the one without createdAt goes last
  if (configA.createdAt && configB.createdAt) {
    return configA.createdAt - configB.createdAt;
  }
  if (configA.createdAt) return -1;
  if (configB.createdAt) return 1;

  // Built-in providers before custom ones, then alphabetical by name
  const isCustomA = configA.type === ProviderTypeEnum.CustomOpenAI;
  const isCustomB = configB.type === ProviderTypeEnum.CustomOpenAI;
  if (isCustomA && !isCustomB) return 1;
  if (!isCustomA && isCustomB) return -1;
  return (configA.name || keyA).localeCompare(configB.name || keyB);
}

export function sortProviderEntries(
  providers: ProviderMap,
  providersFromStorage: Set<string>,
  modifiedProviders: Set<string>,
): Array<[string, ProviderConfig]> {
  const visibleEntries = Object.entries(providers).filter(([providerId, config]) => {
    if (!config || !config.type) {
      console.warn(`Filtering out provider ${providerId} with missing config or type.`);
      return false;
    }
    return providersFromStorage.has(providerId) || modifiedProviders.has(providerId);
  });
  return visibleEntries.sort((a, b) => compareProviderEntries(a, b, providersFromStorage, modifiedProviders));
}
