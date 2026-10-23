import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from './utils/chromeStorageMock';

describe('site permissions store', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorageMock();
  });

  it('stores each origin once, normalized to scheme://host[:port]', async () => {
    const { sitePermissionsStore } = await import('@extension/storage');

    await sitePermissionsStore.addOrigin('https://shop.example.com/cart?x=1');
    await sitePermissionsStore.addOrigin('https://shop.example.com/checkout');
    await sitePermissionsStore.addOrigin('shop.example.com');

    expect(await sitePermissionsStore.getAllowedOrigins()).toEqual(['https://shop.example.com']);
  });

  it('rejects inputs that are not web origins', async () => {
    const { sitePermissionsStore } = await import('@extension/storage');

    expect(await sitePermissionsStore.addOrigin('chrome://settings')).toBeNull();
    expect(await sitePermissionsStore.addOrigin('javascript:alert(1)')).toBeNull();
    expect(await sitePermissionsStore.addOrigin('   ')).toBeNull();
    expect(await sitePermissionsStore.getAllowedOrigins()).toEqual([]);
  });

  it('answers isOriginAllowed for any URL on the allowed origin only', async () => {
    const { sitePermissionsStore } = await import('@extension/storage');
    await sitePermissionsStore.addOrigin('https://a.example.com');

    expect(await sitePermissionsStore.isOriginAllowed('https://a.example.com/page')).toBe(true);
    expect(await sitePermissionsStore.isOriginAllowed('http://a.example.com/page')).toBe(false);
    expect(await sitePermissionsStore.isOriginAllowed('https://b.example.com')).toBe(false);
  });

  it('removes one origin and clears all of them', async () => {
    const { sitePermissionsStore } = await import('@extension/storage');
    await sitePermissionsStore.addOrigin('https://a.example.com');
    await sitePermissionsStore.addOrigin('https://b.example.com');

    await sitePermissionsStore.removeOrigin('https://a.example.com');
    expect(await sitePermissionsStore.getAllowedOrigins()).toEqual(['https://b.example.com']);

    await sitePermissionsStore.clearOrigins();
    expect(await sitePermissionsStore.getAllowedOrigins()).toEqual([]);
  });
});
