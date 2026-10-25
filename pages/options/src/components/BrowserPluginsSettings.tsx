import { useCallback, useEffect, useState } from 'react';
import { browserPluginsStore, type BrowserPlugin } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';
import { BrowserPluginForm } from './BrowserPluginForm';
import { downloadPluginJson, isPluginValidationError, parseImportText, toStoredPlugin } from './browserPluginIO';

const INPUT_CLASS = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground';

export const BrowserPluginsSettings = () => {
  const [plugins, setPlugins] = useState<BrowserPlugin[]>([]);
  const [editing, setEditing] = useState<BrowserPlugin | 'new' | null>(null);
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPlugins(await browserPluginsStore.getAll());
    } catch (loadError) {
      console.error('Failed to load browser plugins:', loadError);
      setError(t('options_plugins_error_loadFailed'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return browserPluginsStore.subscribe(() => void reload());
  }, [reload]);

  const runAction = async (action: () => Promise<void>, failure: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      console.error(failure, actionError);
      setError(failure);
    }
  };

  const handleDelete = (plugin: BrowserPlugin) => {
    if (!window.confirm(t('options_plugins_deleteConfirm', [plugin.name]))) return;
    void runAction(() => browserPluginsStore.remove(plugin.id), t('options_plugins_error_deleteFailed'));
  };

  const handleImport = async (text: string) => {
    setError(null);
    setNotice(null);
    let inputs;
    try {
      inputs = parseImportText(text);
    } catch (importError) {
      if (importError instanceof SyntaxError) {
        setError(t('options_plugins_error_invalidJson'));
        return;
      }
      if (!isPluginValidationError(importError)) throw importError;
      setError(t('options_plugins_error_invalid', [importError.message]));
      return;
    }
    // Imported plugins are user-created, enabled, and replace a stored plugin with the same id.
    await runAction(async () => {
      for (const input of inputs) {
        const existing = (input.id ? await browserPluginsStore.getPlugin(input.id) : undefined) ?? null;
        await browserPluginsStore.save(toStoredPlugin(input, existing));
      }
      setImportText('');
      setNotice(t('options_plugins_imported', [inputs.length.toString()]));
    }, t('options_plugins_error_importFailed'));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    await handleImport(await file.text());
  };

  if (editing) {
    return (
      <BrowserPluginForm
        plugin={editing === 'new' ? null : editing}
        onDone={() => {
          setEditing(null);
          void reload();
        }}
      />
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 text-left shadow-xs">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-foreground">{t('options_plugins_header')}</h2>
          <Button
            onClick={() => setEditing('new')}
            className="bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            {t('options_plugins_btnNew')}
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{t('options_plugins_intro')}</p>

        {error ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? <p className="mb-3 text-sm text-muted-foreground">{notice}</p> : null}

        {loaded && plugins.length === 0 ? (
          <p className="rounded-md bg-muted p-4 text-center text-sm text-muted-foreground">
            {t('options_plugins_empty')}
          </p>
        ) : null}

        <ul className="space-y-3">
          {plugins.map(plugin => (
            <li key={plugin.id} className="rounded-md border border-border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-base font-medium text-foreground">
                    {plugin.name} <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{plugin.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {plugin.matches.length > 0 ? plugin.matches.join(', ') : t('options_plugins_matchesAll')} ·{' '}
                    {t('options_plugins_toolsCount', [plugin.tools.length.toString()])} ·{' '}
                    {t(`options_plugins_createdBy_${plugin.createdBy}`)}
                  </p>
                  {plugin.tools.length > 0 ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {plugin.tools.map(tool => tool.name).join(', ')}
                    </p>
                  ) : null}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={() =>
                      void runAction(
                        () => browserPluginsStore.setEnabled(plugin.id, !plugin.enabled),
                        t('options_plugins_error_saveFailed'),
                      )
                    }
                    className="size-4"
                  />
                  {t('options_plugins_enabled')}
                </label>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => downloadPluginJson(plugin)}
                  className="bg-secondary px-3 py-1.5 text-xs text-foreground">
                  {t('options_plugins_btnExport')}
                </Button>
                <Button onClick={() => setEditing(plugin)} className="bg-secondary px-3 py-1.5 text-xs text-foreground">
                  {t('options_plugins_btnEdit')}
                </Button>
                <Button
                  onClick={() => handleDelete(plugin)}
                  className="bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:opacity-90">
                  {t('options_plugins_btnDelete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-3 border-t border-border pt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">{t('options_plugins_importLabel')}</span>
            <textarea
              className={`${INPUT_CLASS} font-mono text-xs`}
              rows={4}
              value={importText}
              onChange={event => setImportText(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="cursor-pointer rounded bg-secondary px-3 py-1.5 text-xs text-foreground">
              {t('options_plugins_importFile')}
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={event => void handleFile(event.target.files?.[0])}
              />
            </label>
            <Button
              disabled={importText.trim() === ''}
              onClick={() => void handleImport(importText)}
              className="bg-secondary px-3 py-1.5 text-xs text-foreground">
              {t('options_plugins_btnImport')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
