import { parsePlugin, PluginValidationError, type BrowserPlugin, type BrowserPluginInput } from '@extension/storage';

/** Turns a validated input into the stored shape. Keeps the creator and creation time of an existing plugin. */
export function toStoredPlugin(input: BrowserPluginInput, existing: BrowserPlugin | null): BrowserPlugin {
  const now = Date.now();
  return {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    enabled: existing?.enabled ?? input.enabled,
    createdBy: existing?.createdBy ?? 'user',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** Parses an import text holding one plugin object or an array of them. Nothing is returned unless every entry is valid. */
export function parseImportText(text: string): BrowserPluginInput[] {
  const data: unknown = JSON.parse(text);
  const items = Array.isArray(data) ? data : [data];
  return items.map(item => parsePlugin(item));
}

export function isPluginValidationError(error: unknown): error is PluginValidationError {
  return error instanceof PluginValidationError;
}

/** Downloads one plugin as a JSON file that can be imported again. */
export function downloadPluginJson(plugin: BrowserPlugin): void {
  const blob = new Blob([JSON.stringify(plugin, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${plugin.name.replace(/[^\w-]+/g, '_') || 'plugin'}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
