import fs from 'node:fs';
import deepmerge from 'deepmerge';

const packageJson = JSON.parse(fs.readFileSync('../package.json', 'utf8'));

const isFirefox = process.env.__FIREFOX__ === 'true';
const isOpera = process.env.__OPERA__ === 'true';

/**
 * If you want to disable the sidePanel, you can delete withSidePanel function and remove the sidePanel HoC on the manifest declaration.
 *
 * ```js
 * const manifest = { // remove `withSidePanel()`
 * ```
 */
function withSidePanel(manifest) {
  // Firefox does not support sidePanel
  if (isFirefox) {
    return manifest;
  }
  return deepmerge(manifest, {
    side_panel: {
      default_path: 'side-panel/index.html',
    },
    permissions: ['sidePanel'],
  });
}

/**
 * Adds Opera sidebar support using the sidebar_action API.
 * This is compatible with Chrome extensions and won't break Chrome Web Store validation.
 */
function withOperaSidebar(manifest) {
  // Only add Opera sidebar_action if building specifically for Opera
  if (isFirefox || !isOpera) {
    return manifest;
  }

  return deepmerge(manifest, {
    sidebar_action: {
      default_panel: 'side-panel/index.html',
      default_title: 'QAgent',
      default_icon: 'icon-32.png',
    },
  });
}

/**
 * After changing, please reload the extension at `chrome://extensions`
 * @type {chrome.runtime.ManifestV3}
 */
const manifest = withOperaSidebar(
  withSidePanel({
    manifest_version: 3,
    default_locale: 'pt_BR',
    /**
     * if you want to support multiple languages, you can use the following reference
     * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization
     */
    name: '__MSG_app_metadata_name__',
    version: packageJson.version,
    description: '__MSG_app_metadata_description__',
    host_permissions: ['<all_urls>'],
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'tabGroups',
      'contextMenus',
      'debugger',
      'unlimitedStorage',
      'webNavigation',
      'notifications',
      'alarms',
    ],
    // Enterprise policy keys (chrome.storage.managed); see public/managed-schema.json.
    storage: {
      managed_schema: 'managed-schema.json',
    },
    options_page: 'options/index.html',
    background: {
      service_worker: 'background.iife.js',
      type: 'module',
    },
    action: {
      default_icon: 'icon-32.png',
      default_title: 'Abrir QAgent',
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+Period', mac: 'Command+Shift+Period' },
      },
    },
    icons: {
      128: 'icon-128.png',
    },
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*', '<all_urls>'],
        all_frames: true,
        js: ['content/index.iife.js'],
      },
    ],
    // No web_accessible_resources: the content script loads nothing from the extension and the permission
    // page opens in its own extension window. Exposing files let any site fingerprint or frame the extension.
  }),
);

export default manifest;
