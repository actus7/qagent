/**
 * Enterprise policy read from chrome.storage.managed (schema: chrome-extension/public/managed-schema.json).
 * Every key is optional; an unmanaged browser yields EMPTY_MANAGED_POLICY (no restrictions).
 */
export interface ManagedPolicy {
  allowedProviders: string[];
}

const MAX_PATTERNS = 500;
const MAX_PATTERN_LENGTH = 300;

export const EMPTY_MANAGED_POLICY: ManagedPolicy = {
  allowedProviders: [],
};

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0 && item.length <= MAX_PATTERN_LENGTH);
  return [...new Set(entries)].slice(0, MAX_PATTERNS);
}

/** Converts untrusted managed storage into a policy. Wrong types are ignored, never trusted. */
export function parseManagedPolicy(raw: unknown): ManagedPolicy {
  if (typeof raw !== 'object' || raw === null) return EMPTY_MANAGED_POLICY;
  const record = raw as Record<string, unknown>;
  return {
    allowedProviders: sanitizeStringList(record.allowedProviders).map(id => id.toLowerCase()),
  };
}

export function hasManagedRestrictions(policy: ManagedPolicy): boolean {
  return policy.allowedProviders.length > 0;
}

/** Provider is matched by its configured id or by its provider type (case-insensitive). */
export function isManagedProviderAllowed(provider: { id: string; type?: string }, policy: ManagedPolicy): boolean {
  if (policy.allowedProviders.length === 0) return true;
  const candidates = [provider.id, provider.type].filter((value): value is string => !!value).map(v => v.toLowerCase());
  return candidates.some(candidate => policy.allowedProviders.includes(candidate));
}
