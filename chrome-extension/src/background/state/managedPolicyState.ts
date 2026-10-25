import { EMPTY_MANAGED_POLICY, type ManagedPolicy } from '@extension/shared';

// Cached copy of chrome.storage.managed. Kept free of chrome/storage imports so it stays synchronous and testable.
let cachedPolicy: ManagedPolicy = EMPTY_MANAGED_POLICY;

export function getManagedPolicy(): ManagedPolicy {
  return cachedPolicy;
}

export function setManagedPolicy(policy: ManagedPolicy): void {
  cachedPolicy = policy;
}
