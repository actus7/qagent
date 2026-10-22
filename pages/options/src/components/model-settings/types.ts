import type { ProviderConfig } from '@extension/storage';

export interface AgentModelParameters {
  temperature: number;
  topP: number;
  requestsPerMinute: number;
}

export type ParameterName = keyof AgentModelParameters;

export interface ParameterChangeOptions {
  debounceMs?: number;
}

export interface AvailableModel {
  provider: string;
  providerName: string;
  model: string;
}

export type ProviderMap = Record<string, ProviderConfig>;

/** Provider fields that hold a list of strings and are edited as tags. */
export type ListField = 'modelNames' | 'azureDeploymentNames';
