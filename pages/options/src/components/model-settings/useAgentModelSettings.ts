import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentNameEnum,
  agentModelStore,
  getDefaultAgentModelParams,
  getDefaultModelRequestsPerMinute,
  normalizeReasoningEffort,
} from '@extension/storage';
import type { ReasoningEffort } from '@extension/storage';
import { MIN_REQUESTS_PER_MINUTE, PARAMETER_SAVE_DEBOUNCE_MS } from './constants';
import {
  createDefaultModelParameters,
  createDefaultReasoningEffort,
  createEmptySelectedModels,
  getDefaultReasoningEffort,
  isOpenAIReasoningModel,
  normalizeParameterValue,
  toStoredParameters,
} from './modelUtils';
import type { AgentModelParameters, ParameterChangeOptions, ParameterName } from './types';

export function useAgentModelSettings() {
  const [selectedModels, setSelectedModels] = useState<Record<AgentNameEnum, string>>(() =>
    createEmptySelectedModels(),
  );
  const [modelParameters, setModelParameters] = useState<Record<AgentNameEnum, AgentModelParameters>>(() =>
    createDefaultModelParameters(),
  );
  const [reasoningEffort, setReasoningEffort] = useState<Record<AgentNameEnum, ReasoningEffort | undefined>>(() =>
    createDefaultReasoningEffort(),
  );
  const selectedModelsRef = useRef<Record<AgentNameEnum, string>>(createEmptySelectedModels());
  const modelParametersRef = useRef<Record<AgentNameEnum, AgentModelParameters>>(createDefaultModelParameters());
  const parameterPersistTimeoutsRef = useRef<Partial<Record<AgentNameEnum, number>>>({});

  // Load saved agent models and parameters on mount
  useEffect(() => {
    let cancelled = false;

    const loadAgentModels = async () => {
      try {
        const agents = Object.values(AgentNameEnum);
        const configs = await Promise.all(agents.map(agent => agentModelStore.getAgentModel(agent)));
        if (cancelled) {
          return;
        }

        const nextSelectedModels = createEmptySelectedModels();
        const nextModelParameters = createDefaultModelParameters();
        const nextReasoningEffort = createDefaultReasoningEffort();

        agents.forEach((agent, index) => {
          const config = configs[index];
          if (!config) {
            return;
          }

          nextSelectedModels[agent] = `${config.provider}>${config.modelName}`;

          const savedTemperature =
            typeof config.parameters?.temperature === 'number'
              ? config.parameters.temperature
              : nextModelParameters[agent].temperature;
          const savedTopP =
            typeof config.parameters?.topP === 'number' ? config.parameters.topP : nextModelParameters[agent].topP;
          const savedRequestsPerMinute =
            typeof config.requestsPerMinute === 'number' && Number.isFinite(config.requestsPerMinute)
              ? Math.max(MIN_REQUESTS_PER_MINUTE, Math.round(config.requestsPerMinute))
              : getDefaultModelRequestsPerMinute(config.provider, config.modelName);

          nextModelParameters[agent] = {
            temperature: savedTemperature,
            topP: savedTopP,
            requestsPerMinute: savedRequestsPerMinute,
          };

          const normalizedReasoningEffort = normalizeReasoningEffort(config.reasoningEffort);
          if (normalizedReasoningEffort) {
            nextReasoningEffort[agent] = normalizedReasoningEffort;
          }
        });

        selectedModelsRef.current = nextSelectedModels;
        modelParametersRef.current = nextModelParameters;
        setSelectedModels(nextSelectedModels);
        setModelParameters(nextModelParameters);
        setReasoningEffort(nextReasoningEffort);
      } catch (error) {
        console.error('Error loading agent models:', error);
      }
    };

    void loadAgentModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  useEffect(() => {
    modelParametersRef.current = modelParameters;
  }, [modelParameters]);

  useEffect(() => {
    const parameterPersistTimeouts = parameterPersistTimeoutsRef.current;
    return () => {
      for (const timeoutId of Object.values(parameterPersistTimeouts)) {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
    };
  }, []);

  const handleModelChange = async (agentName: AgentNameEnum, modelValue: string) => {
    // modelValue is "provider>model"
    const [provider, model] = modelValue.split('>');

    const defaults = getDefaultAgentModelParams(provider, agentName);
    const newParameters: AgentModelParameters = {
      temperature: typeof defaults.temperature === 'number' ? defaults.temperature : 0.1,
      topP: typeof defaults.topP === 'number' ? defaults.topP : 0.1,
      requestsPerMinute: getDefaultModelRequestsPerMinute(provider, model),
    };

    const pendingTimeout = parameterPersistTimeoutsRef.current[agentName];
    if (pendingTimeout !== undefined) {
      window.clearTimeout(pendingTimeout);
      delete parameterPersistTimeoutsRef.current[agentName];
    }

    setModelParameters(prev => {
      const next = { ...prev, [agentName]: newParameters };
      modelParametersRef.current = next;
      return next;
    });

    setSelectedModels(prev => {
      const next = { ...prev, [agentName]: modelValue };
      selectedModelsRef.current = next;
      return next;
    });

    try {
      if (!model) {
        await agentModelStore.resetAgentModel(agentName);
        return;
      }

      const isReasoningModel = isOpenAIReasoningModel(modelValue);
      // Same value for state and storage, so the UI never shows an effort that wasn't saved
      const effort = isReasoningModel ? reasoningEffort[agentName] || getDefaultReasoningEffort(agentName) : undefined;
      setReasoningEffort(prev => ({ ...prev, [agentName]: effort }));

      await agentModelStore.setAgentModel(agentName, {
        provider,
        modelName: model,
        parameters: toStoredParameters(modelValue, newParameters),
        requestsPerMinute: newParameters.requestsPerMinute,
        reasoningEffort: effort,
      });
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const handleReasoningEffortChange = async (agentName: AgentNameEnum, value: ReasoningEffort) => {
    setReasoningEffort(prev => ({ ...prev, [agentName]: value }));

    const selectedModel = selectedModelsRef.current[agentName];
    if (!selectedModel || !isOpenAIReasoningModel(selectedModel)) {
      return;
    }

    try {
      const [provider, modelName] = selectedModel.split('>');
      if (provider && modelName) {
        const currentParameters = modelParametersRef.current[agentName];
        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName,
          parameters: toStoredParameters(selectedModel, currentParameters),
          requestsPerMinute: currentParameters.requestsPerMinute,
          reasoningEffort: value,
        });
      }
    } catch (error) {
      console.error('Error saving reasoning effort:', error);
    }
  };

  const persistAgentParameters = useCallback(async (agentName: AgentNameEnum, newParameters: AgentModelParameters) => {
    const selectedModel = selectedModelsRef.current[agentName];
    if (!selectedModel) {
      return;
    }

    try {
      const [provider, modelName] = selectedModel.split('>');
      if (!provider || !modelName) {
        return;
      }

      await agentModelStore.setAgentModel(agentName, {
        provider,
        modelName,
        parameters: toStoredParameters(selectedModel, newParameters),
        requestsPerMinute: newParameters.requestsPerMinute,
      });
    } catch (error) {
      console.error('Error saving agent parameters:', error);
    }
  }, []);

  const handleParameterChange = (
    agentName: AgentNameEnum,
    paramName: ParameterName,
    value: number,
    options?: ParameterChangeOptions,
  ) => {
    const newParameters: AgentModelParameters = {
      ...modelParametersRef.current[agentName],
      [paramName]: normalizeParameterValue(paramName, value),
    };

    modelParametersRef.current = { ...modelParametersRef.current, [agentName]: newParameters };
    setModelParameters(prev => ({ ...prev, [agentName]: newParameters }));

    const pendingTimeout = parameterPersistTimeoutsRef.current[agentName];
    if (pendingTimeout !== undefined) {
      window.clearTimeout(pendingTimeout);
    }

    const debounceMs = options?.debounceMs ?? PARAMETER_SAVE_DEBOUNCE_MS;
    if (debounceMs <= 0) {
      void persistAgentParameters(agentName, newParameters);
      delete parameterPersistTimeoutsRef.current[agentName];
      return;
    }

    parameterPersistTimeoutsRef.current[agentName] = window.setTimeout(() => {
      void persistAgentParameters(agentName, newParameters);
      delete parameterPersistTimeoutsRef.current[agentName];
    }, debounceMs);
  };

  return {
    selectedModels,
    modelParameters,
    reasoningEffort,
    handleModelChange,
    handleReasoningEffortChange,
    handleParameterChange,
  };
}

export type AgentModelSettings = ReturnType<typeof useAgentModelSettings>;
