import { t } from '@extension/i18n';
import { agentModelStore, llmProviderStore } from '@extension/storage';
import {
  applyManagedTaskOptions,
  EMPTY_MANAGED_POLICY,
  isManagedProviderAllowed,
  parseManagedPolicy,
  type ManagedPolicy,
  type SidePanelTaskCommand,
} from '@extension/shared';
import { createLogger } from '../log';
import { getManagedPolicy, setManagedPolicy } from '../state/managedPolicyState';

const logger = createLogger('background');

/**
 * Reads chrome.storage.managed into the cache. Unmanaged browsers, or a storage error, mean no restrictions.
 */
export async function loadManagedPolicy(): Promise<ManagedPolicy> {
  try {
    const raw: unknown = await chrome.storage.managed.get(null);
    setManagedPolicy(parseManagedPolicy(raw));
  } catch (error) {
    logger.info('managed policy unavailable, running without restrictions', error);
    setManagedPolicy(EMPTY_MANAGED_POLICY);
  }
  return getManagedPolicy();
}

/** Keeps the cache in sync when an administrator changes the policy while the browser runs. */
export function registerManagedPolicyListener(): void {
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'managed') void loadManagedPolicy();
  });
}

/** Refuses the task when a configured model agent uses a provider outside allowedProviders. */
export async function assertManagedProvidersAllowed(policy: ManagedPolicy): Promise<void> {
  if (policy.allowedProviders.length === 0) return;
  const [models, providers] = await Promise.all([agentModelStore.getAllAgentModels(), llmProviderStore.getAllProviders()]);
  for (const model of Object.values(models)) {
    const providerConfig = providers[model.provider];
    if (!providerConfig) continue;
    if (!isManagedProviderAllowed({ id: model.provider, type: providerConfig.type }, policy)) {
      throw new Error(t('bg_managed_providerBlocked', [model.provider]));
    }
  }
}

/**
 * Enforces the managed policy on a task before it starts: permission mode coercion and provider checks.
 * Used by every entry point (side panel and MCP bridge), so both follow the same rules.
 */
export async function prepareManagedTask(message: SidePanelTaskCommand): Promise<SidePanelTaskCommand> {
  const policy = await loadManagedPolicy();
  await assertManagedProvidersAllowed(policy);
  return { ...message, options: applyManagedTaskOptions(message.options, policy) };
}
