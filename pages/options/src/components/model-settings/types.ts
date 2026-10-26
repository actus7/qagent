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

/** A stored provider that has no models yet and can load them from its model catalog. */
export interface CatalogProviderEntry {
  id: string;
  name: string;
}

/** Provider fields that hold a list of strings and are edited as tags. */
export type ListField = 'modelNames' | 'azureDeploymentNames';
