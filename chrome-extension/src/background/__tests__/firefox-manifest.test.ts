import { describe, expect, it, vi, beforeEach } from 'vitest';
import { convertToFirefoxCompatibleManifest, DEFAULT_GECKO_ID } from '@extension/dev-utils/lib/manifest-parser/impl';
import type { Manifest } from '@extension/dev-utils/lib/manifest-parser/type';

async function loadManifest(firefox: boolean): Promise<Manifest> {
  vi.resetModules();
  vi.stubEnv('__FIREFOX__', firefox ? 'true' : '');
  const mod = (await import('../../../manifest.js')) as { default: Manifest };
  return mod.default;
}

type LooseManifest = Manifest & Record<string, unknown>;

describe('Chromium manifest', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('keeps the service worker, debugger, tab groups and side panel', async () => {
    const manifest = (await loadManifest(false)) as LooseManifest;
    expect(manifest.background).toEqual({ service_worker: 'background.iife.js', type: 'module' });
    expect(manifest.permissions).toEqual(expect.arrayContaining(['debugger', 'tabGroups', 'sidePanel']));
    expect(manifest.sidebar_action).toBeUndefined();
  });
});

describe('Firefox manifest transform', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('drops Chromium-only permissions and managed storage', async () => {
    const manifest = (await loadManifest(true)) as LooseManifest;
    const converted = convertToFirefoxCompatibleManifest(manifest) as LooseManifest;
    expect(converted.permissions).not.toContain('debugger');
    expect(converted.permissions).not.toContain('tabGroups');
    expect(converted.permissions).toContain('scripting');
    expect(converted.storage).toBeUndefined();
    expect(converted.side_panel).toBeUndefined();
  });

  it('runs the background as an event page script with a gecko id', async () => {
    const manifest = (await loadManifest(true)) as LooseManifest;
    const converted = convertToFirefoxCompatibleManifest(manifest) as LooseManifest;
    expect(converted.background).toEqual({ scripts: ['background.iife.js'] });
    expect(converted.browser_specific_settings).toEqual({
      gecko: { id: DEFAULT_GECKO_ID, strict_min_version: '128.0' },
    });
    expect(converted.options_ui).toEqual({ page: 'options/index.html', browser_style: false });
    expect(converted.options_page).toBeUndefined();
  });

  it('exposes the agent UI as a sidebar_action', async () => {
    const manifest = (await loadManifest(true)) as LooseManifest;
    expect(manifest.sidebar_action).toEqual(expect.objectContaining({ default_panel: 'side-panel/index.html' }));
  });
});
