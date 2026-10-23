import { EMPTY_MANAGED_POLICY, evaluateManagedUrl, type ManagedPolicy } from '@extension/shared';

// Cached copy of chrome.storage.managed. Kept free of chrome/storage imports so URL checks stay synchronous and testable.
let cachedPolicy: ManagedPolicy = EMPTY_MANAGED_POLICY;

export function getManagedPolicy(): ManagedPolicy {
  return cachedPolicy;
}

export function setManagedPolicy(policy: ManagedPolicy): void {
  cachedPolicy = policy;
}

/** about:blank is the new-tab placeholder; it never reaches the web, so managed URL patterns do not apply to it. */
export function isManagedUrlAllowed(url: string): boolean {
  if (url === 'about:blank') return true;
  return evaluateManagedUrl(url, cachedPolicy).allowed;
}
