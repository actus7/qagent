import type { ManifestParserInterface, Manifest } from './type';

export const ManifestParserImpl: ManifestParserInterface = {
  convertManifestToString: (manifest, env) => {
    if (env === 'firefox') {
      manifest = convertToFirefoxCompatibleManifest(manifest);
    }
    return JSON.stringify(manifest, null, 2);
  },
};

/** Chromium-only permissions. Firefox has no chrome.debugger and no tab groups. */
export const FIREFOX_UNSUPPORTED_PERMISSIONS: ReadonlySet<string> = new Set(['debugger', 'tabGroups']);
/** Placeholder add-on id. Replace it with the id registered on addons.mozilla.org before publishing. */
export const DEFAULT_GECKO_ID = 'qagent@localhost';
/** Firefox 128 is the first release with MV3 event pages and scripting world MAIN. */
export const FIREFOX_MIN_VERSION = '128.0';

export function convertToFirefoxCompatibleManifest(manifest: Manifest) {
  const manifestCopy = {
    ...manifest,
  } as { [key: string]: unknown };

  // Firefox MV3 runs the background as a non-persistent event page with classic scripts (the bundle is an IIFE).
  manifestCopy.background = {
    scripts: [manifest.background?.service_worker],
  };
  manifestCopy.options_ui = {
    page: manifest.options_page,
    browser_style: false,
  };
  manifestCopy.content_security_policy = {
    extension_pages: "script-src 'self'; object-src 'self'",
  };
  manifestCopy.browser_specific_settings = {
    gecko: {
      id: DEFAULT_GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
    },
  };
  manifestCopy.permissions = (manifest.permissions ?? []).filter(
    permission => !FIREFOX_UNSUPPORTED_PERMISSIONS.has(permission),
  );
  // Managed-schema storage is Chromium-only; Firefox reports unknown keys as warnings.
  delete manifestCopy.options_page;
  delete manifestCopy.storage;
  return manifestCopy as Manifest;
}
