import { AgentNameEnum } from '@extension/storage';
import type { ReasoningEffort } from '@extension/storage';
import { MAX_REQUESTS_PER_MINUTE, MIN_REQUESTS_PER_MINUTE } from './constants';
import type { AgentModelParameters, ParameterName } from './types';

/** O-series and GPT-5 (except gpt-5-chat) models accept a reasoning effort setting. */
export function isOpenAIReasoningModel(modelName: string): boolean {
  let modelNameWithoutProvider = modelName;
  if (modelName.includes('>')) {
    modelNameWithoutProvider = modelName.split('>')[1];
  }
  if (modelNameWithoutProvider.startsWith('openai/')) {
    modelNameWithoutProvider = modelNameWithoutProvider.substring(7);
  }
  return (
    modelNameWithoutProvider.startsWith('o') ||
    (modelNameWithoutProvider.startsWith('gpt-5') && !modelNameWithoutProvider.startsWith('gpt-5-chat'))
  );
}

export function isAnthropicModel(modelName: string): boolean {
  const modelNameWithoutProvider = modelName.includes('>') ? modelName.split('>')[1] : modelName;
  return modelNameWithoutProvider.startsWith('claude-');
}

/** Stored as "provider>model", the format used by every model select. */
export function toModelValue(provider: string, model: string): string {
  return `${provider}>${model}`;
}

export function getDefaultReasoningEffort(agentName: AgentNameEnum): ReasoningEffort {
  return agentName === AgentNameEnum.Planner ? 'low' : 'minimal';
}

/** Anthropic models only take temperature; everything else also takes topP. */
export function toStoredParameters(
  modelValue: string,
  parameters: AgentModelParameters,
): { temperature: number; topP?: number } {
  return isAnthropicModel(modelValue)
    ? { temperature: parameters.temperature }
    : { temperature: parameters.temperature, topP: parameters.topP };
}

export function normalizeParameterValue(paramName: ParameterName, value: number): number {
  if (paramName !== 'requestsPerMinute') {
    return value;
  }
  const safeValue = Number.isFinite(value) ? value : MIN_REQUESTS_PER_MINUTE;
  return Math.max(MIN_REQUESTS_PER_MINUTE, Math.min(MAX_REQUESTS_PER_MINUTE, Math.round(safeValue)));
}

export function createEmptySelectedModels(): Record<AgentNameEnum, string> {
  return {
    [AgentNameEnum.Navigator]: '',
    [AgentNameEnum.Planner]: '',
  };
}

export function createDefaultModelParameters(): Record<AgentNameEnum, AgentModelParameters> {
  return {
    [AgentNameEnum.Navigator]: { temperature: 0, topP: 0, requestsPerMinute: 10 },
    [AgentNameEnum.Planner]: { temperature: 0, topP: 0, requestsPerMinute: 10 },
  };
}

export function createDefaultReasoningEffort(): Record<AgentNameEnum, ReasoningEffort | undefined> {
  return {
    [AgentNameEnum.Navigator]: undefined,
    [AgentNameEnum.Planner]: undefined,
  };
}
