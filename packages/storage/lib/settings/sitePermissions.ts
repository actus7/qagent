import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Origins (scheme://host[:port]) the user always allows the agent to act on without per-action prompts.
export interface SitePermissionsConfig {
  allowedOrigins: string[];
}

/**
 * Normalizes a URL to its origin (scheme://host[:port]). Only http and https are accepted.
 * @returns the normalized origin, or null when the input is not a valid web URL
 */
export function normalizeSiteOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.origin;
}

type SitePermissionsStorage = BaseStorage<SitePermissionsConfig> & {
  getAllowedOrigins: () => Promise<string[]>;
  isOriginAllowed: (origin: string) => Promise<boolean>;
  addOrigin: (input: string) => Promise<string | null>;
  removeOrigin: (origin: string) => Promise<void>;
  clearOrigins: () => Promise<void>;
};

const DEFAULT_SITE_PERMISSIONS: SitePermissionsConfig = { allowedOrigins: [] };

const storage = createStorage<SitePermissionsConfig>('site-permissions', DEFAULT_SITE_PERMISSIONS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const sitePermissionsStore: SitePermissionsStorage = {
  ...storage,
  async getAllowedOrigins() {
    const settings = (await storage.get()) || DEFAULT_SITE_PERMISSIONS;
    return settings.allowedOrigins;
  },
  async isOriginAllowed(origin: string) {
    const normalized = normalizeSiteOrigin(origin);
    if (!normalized) return false;
    return (await this.getAllowedOrigins()).includes(normalized);
  },
  async addOrigin(input: string) {
    const normalized = normalizeSiteOrigin(input);
    if (!normalized) return null;
    const current = await this.getAllowedOrigins();
    if (!current.includes(normalized)) {
      await storage.set({ allowedOrigins: [...current, normalized] });
    }
    return normalized;
  },
  async removeOrigin(origin: string) {
    const current = await this.getAllowedOrigins();
    await storage.set({ allowedOrigins: current.filter(item => item !== origin) });
  },
  async clearOrigins() {
    await storage.set(DEFAULT_SITE_PERMISSIONS);
  },
};
