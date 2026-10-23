import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '@extension/i18n';
import { ProviderTypeEnum, agentModelStore, getDefaultProviderConfig, llmProviderStore } from '@extension/storage';
import type { ProviderConfig } from '@extension/storage';
import { PROVIDER_SCROLL_DELAY_MS } from './constants';
import {
  addToListField,
  buildAvailableModels,
  buildProviderConfigToSave,
  getDefaultModelNames,
  getNextAzureProviderId,
  getNextCustomProviderNumber,
  getProviderSaveError,
  getProviderSaveErrorMessage,
  removeFromListField,
  sortProviderEntries,
  withPendingEntry,
} from './providerUtils';
import type { AvailableModel, ProviderMap } from './types';

interface UseProviderSettingsOptions {
  /** Called when agents were reset because the provider or one of its models was removed. */
  onAgentModelsReset?: () => void;
}

async function loadAvailableModels(): Promise<AvailableModel[]> {
  try {
    return buildAvailableModels(await llmProviderStore.getAllProviders());
  } catch (error) {
    console.error('Error loading providers for model selection:', error);
    return [];
  }
}

function scrollToProviderSoon(providerId: string): void {
  setTimeout(() => {
    document.getElementById(`provider-${providerId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, PROVIDER_SCROLL_DELAY_MS);
}

export function useProviderSettings({ onAgentModelsReset }: UseProviderSettingsOptions = {}) {
  const [providers, setProviders] = useState<ProviderMap>({});
  const [modifiedProviders, setModifiedProviders] = useState<Set<string>>(() => new Set());
  const [providersFromStorage, setProvidersFromStorage] = useState<Set<string>>(() => new Set());
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>({});
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const newlyAddedProviderRef = useRef<string | null>(null);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const allProviders = await llmProviderStore.getAllProviders();
        setProvidersFromStorage(new Set(Object.keys(allProviders)));
        setProviders(allProviders);
      } catch (error) {
        console.error('Error loading providers:', error);
        setProviders({});
        setProvidersFromStorage(new Set());
      }
    };
    void loadProviders();
  }, []);

  // Focus the first input of a freshly added provider
  useEffect(() => {
    const providerId = newlyAddedProviderRef.current;
    if (!providerId || !providers[providerId]) {
      return;
    }
    const inputId =
      providers[providerId].type === ProviderTypeEnum.CustomOpenAI ? `${providerId}-name` : `${providerId}-api-key`;
    document.getElementById(inputId)?.focus();
    newlyAddedProviderRef.current = null;
  }, [providers]);

  // Close the provider dropdown on outside click
  useEffect(() => {
    if (!isProviderSelectorOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-provider-selector-container]')) {
        setIsProviderSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProviderSelectorOpen]);

  // Refresh the model list whenever stored providers change
  useEffect(() => {
    let active = true;
    const updateAvailableModels = async () => {
      const models = await loadAvailableModels();
      if (active) {
        setAvailableModels(models);
      }
    };
    const unsubscribe = llmProviderStore.subscribe(() => {
      void updateAvailableModels();
    });
    void updateAvailableModels();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const markModified = (provider: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
  };

  const clearModelInput = (provider: string) => {
    setNewModelInputs(prev => ({ ...prev, [provider]: '' }));
  };

  const handleApiKeyChange = (provider: string, apiKey: string, baseUrl?: string) => {
    markModified(provider);
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        apiKey: apiKey.trim(),
        baseUrl: baseUrl !== undefined ? baseUrl.trim() : prev[provider]?.baseUrl,
      },
    }));
  };

  const toggleApiKeyVisibility = (provider: string) => {
    setVisibleApiKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleNameChange = (provider: string, name: string) => {
    markModified(provider);
    setProviders(prev => ({
      ...prev,
      [provider]: { ...prev[provider], name: name.trim() },
    }));
  };

  const handleModelsChange = (provider: string, modelsString: string) => {
    setNewModelInputs(prev => ({ ...prev, [provider]: modelsString }));
  };

  const addModel = (provider: string, model: string) => {
    if (!model.trim()) return;
    markModified(provider);
    setProviders(prev => addToListField(prev, provider, 'modelNames', model.trim(), getDefaultModelNames(provider)));
    clearModelInput(provider);
  };

  const removeModel = (provider: string, modelToRemove: string) => {
    markModified(provider);
    setProviders(prev =>
      removeFromListField(prev, provider, 'modelNames', modelToRemove, getDefaultModelNames(provider)),
    );
  };

  const handleModelInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, provider: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      addModel(provider, newModelInputs[provider] || '');
    }
  };

  const addAzureDeployment = (provider: string, deploymentName: string) => {
    if (!deploymentName.trim()) return;
    markModified(provider);
    setProviders(prev => addToListField(prev, provider, 'azureDeploymentNames', deploymentName.trim(), []));
    clearModelInput(provider);
  };

  const removeAzureDeployment = (provider: string, deploymentToRemove: string) => {
    markModified(provider);
    setProviders(prev => removeFromListField(prev, provider, 'azureDeploymentNames', deploymentToRemove, []));
  };

  const handleAzureDeploymentKeyDown = (event: KeyboardEvent<HTMLInputElement>, provider: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const value = newModelInputs[provider] || '';
      if (value.trim()) {
        addAzureDeployment(provider, value.trim());
      }
    }
  };

  const handleAzureApiVersionChange = (provider: string, apiVersion: string) => {
    markModified(provider);
    setProviders(prev => ({
      ...prev,
      [provider]: { ...prev[provider], azureApiVersion: apiVersion.trim() },
    }));
  };

  const setErrorFor = (setter: typeof setSaveErrors, providerId: string, message: string | null) => {
    setter(prev => {
      const next = { ...prev };
      if (message) {
        next[providerId] = message;
      } else {
        delete next[providerId];
      }
      return next;
    });
  };

  const notifyIfAgentsReset = async (providerId: string, keepModelNames: string[]) => {
    const resetAgents = await agentModelStore.resetAgentModelsForProvider(providerId, keepModelNames);
    if (resetAgents.length > 0) {
      onAgentModelsReset?.();
    }
  };

  const handleSave = async (providerId: string) => {
    const config = withPendingEntry(providerId, providers[providerId], newModelInputs[providerId]);
    if (!config) {
      return;
    }
    const saveError = getProviderSaveError(config);
    if (saveError === 'spacesInName') {
      setErrorFor(setNameErrors, providerId, getProviderSaveErrorMessage(saveError, providerId));
      return;
    }
    if (saveError) {
      setErrorFor(setSaveErrors, providerId, getProviderSaveErrorMessage(saveError, providerId));
      return;
    }

    try {
      const payloadToSave = buildProviderConfigToSave(providerId, config);
      await llmProviderStore.setProvider(providerId, payloadToSave);
      const keepModelNames =
        payloadToSave.type === ProviderTypeEnum.AzureOpenAI
          ? (payloadToSave.azureDeploymentNames ?? [])
          : (payloadToSave.modelNames ?? []);
      await notifyIfAgentsReset(providerId, keepModelNames);

      setProviders(prev => ({ ...prev, [providerId]: config }));
      setNewModelInputs(prev => ({ ...prev, [providerId]: '' }));
      setErrorFor(setNameErrors, providerId, null);
      setErrorFor(setSaveErrors, providerId, null);
      setProvidersFromStorage(prev => new Set(prev).add(providerId));
      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
    } catch (error) {
      console.error('Error saving provider:', error);
      setErrorFor(setSaveErrors, providerId, t('options_models_providers_errors_saveFailed'));
    }
  };

  const handleDelete = async (providerId: string) => {
    try {
      await llmProviderStore.removeProvider(providerId);
      await notifyIfAgentsReset(providerId, []);
      setProvidersFromStorage(prev => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
      setProviders(prev => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
    } catch (error) {
      console.error('Error deleting provider:', error);
      setErrorFor(setSaveErrors, providerId, t('options_models_providers_errors_deleteFailed'));
    }
  };

  /** Stored providers revert to their saved config; unsaved ones are discarded. */
  const handleCancelProvider = async (providerId: string) => {
    if (providersFromStorage.has(providerId)) {
      try {
        const stored = await llmProviderStore.getProvider(providerId);
        if (stored) {
          setProviders(prev => ({ ...prev, [providerId]: stored }));
        }
      } catch (error) {
        console.error('Error restoring provider:', error);
        return;
      }
    } else {
      setProviders(prev => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
    }
    setModifiedProviders(prev => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
    setNewModelInputs(prev => ({ ...prev, [providerId]: '' }));
    setErrorFor(setNameErrors, providerId, null);
    setErrorFor(setSaveErrors, providerId, null);
  };

  const addProviderEntry = (providerId: string, config: ProviderConfig) => {
    setProviders(prev => ({ ...prev, [providerId]: config }));
    markModified(providerId);
    newlyAddedProviderRef.current = providerId;
    scrollToProviderSoon(providerId);
  };

  const addCustomProvider = () => {
    const nextNumber = getNextCustomProviderNumber(providers);
    addProviderEntry(`custom_openai_${nextNumber}`, {
      apiKey: '',
      name: `CustomProvider${nextNumber}`,
      type: ProviderTypeEnum.CustomOpenAI,
      baseUrl: '',
      modelNames: [],
      createdAt: Date.now(),
    });
  };

  const addAzureProvider = () => {
    const { providerId, nextNumber } = getNextAzureProviderId(providers);
    addProviderEntry(providerId, {
      ...getDefaultProviderConfig(ProviderTypeEnum.AzureOpenAI),
      name: `Azure OpenAI ${nextNumber}`,
    });
  };

  const handleProviderSelection = (providerType: string) => {
    setIsProviderSelectorOpen(false);
    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      addCustomProvider();
    } else if (providerType === ProviderTypeEnum.AzureOpenAI) {
      addAzureProvider();
    } else {
      addProviderEntry(providerType, getDefaultProviderConfig(providerType));
    }
  };

  const sortedProviders = useMemo(
    () => sortProviderEntries(providers, providersFromStorage, modifiedProviders),
    [providers, providersFromStorage, modifiedProviders],
  );

  return {
    providers,
    modifiedProviders,
    providersFromStorage,
    newModelInputs,
    nameErrors,
    saveErrors,
    visibleApiKeys,
    availableModels,
    sortedProviders,
    isProviderSelectorOpen,
    toggleProviderSelector: () => setIsProviderSelectorOpen(prev => !prev),
    handleApiKeyChange,
    toggleApiKeyVisibility,
    handleNameChange,
    handleModelsChange,
    handleModelInputKeyDown,
    removeModel,
    handleAzureDeploymentKeyDown,
    removeAzureDeployment,
    handleAzureApiVersionChange,
    handleSave,
    handleDelete,
    handleCancelProvider,
    handleProviderSelection,
  };
}

export type ProviderSettings = ReturnType<typeof useProviderSettings>;
