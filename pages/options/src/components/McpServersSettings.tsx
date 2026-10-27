import { useCallback, useEffect, useState } from 'react';
import { mcpServersStore, type McpServer } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';
import { McpServerForm } from './McpServerForm';

export const McpServersSettings = () => {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setServers(await mcpServersStore.getAll());
    } catch (loadError) {
      console.error('Failed to load MCP servers:', loadError);
      setError(t('options_mcp_error_loadFailed'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return mcpServersStore.subscribe(() => void reload());
  }, [reload]);

  const handleToggle = async (server: McpServer) => {
    setError(null);
    try {
      await mcpServersStore.save({ ...server, enabled: !server.enabled });
    } catch (saveError) {
      console.error('Failed to update MCP server:', saveError);
      setError(t('options_mcp_error_saveFailed'));
    }
  };

  const handleDelete = async (server: McpServer) => {
    if (!window.confirm(t('options_mcp_deleteConfirm', [server.name]))) return;
    setError(null);
    try {
      await mcpServersStore.remove(server.id);
    } catch (removeError) {
      console.error('Failed to remove MCP server:', removeError);
      setError(t('options_mcp_error_deleteFailed'));
    }
  };

  if (editing) {
    return (
      <McpServerForm
        server={editing === 'new' ? null : editing}
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
          <h2 className="text-xl font-semibold text-foreground">{t('options_mcpServers_header')}</h2>
          <Button
            size="compact"
            onClick={() => setEditing('new')}
            className="bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            {t('options_mcp_btnNew')}
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{t('options_mcp_intro')}</p>

        {error ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {loaded && servers.length === 0 ? (
          <p className="rounded-md bg-muted p-4 text-center text-sm text-muted-foreground">{t('options_mcp_empty')}</p>
        ) : null}

        <ul className="space-y-3">
          {servers.map(server => (
            <li key={server.id} className="rounded-md border border-border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-base font-medium text-foreground">{server.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{server.url}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={() => void handleToggle(server)}
                    className="size-4"
                  />
                  {t('options_mcp_enabled')}
                </label>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  size="compact"
                  onClick={() => setEditing(server)}
                  className="bg-secondary px-3 py-1.5 text-xs text-foreground">
                  {t('options_mcp_btnEdit')}
                </Button>
                <Button
                  size="compact"
                  onClick={() => void handleDelete(server)}
                  className="bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:opacity-90">
                  {t('options_mcp_btnDelete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
