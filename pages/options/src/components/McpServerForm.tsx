import { useState } from 'react';
import { mcpServersStore, type McpServer } from '@extension/storage';
import { listMcpTools } from '@extension/shared';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

const INPUT_CLASS = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground';

/** One "Name: value" header per line; null when a line has no name. */
function parseHeaderLines(text: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const index = line.indexOf(':');
    const name = index > 0 ? line.slice(0, index).trim() : '';
    if (name === '') return null;
    headers[name] = line.slice(index + 1).trim();
  }
  return headers;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface McpServerFormProps {
  server: McpServer | null;
  onDone: () => void;
}

export const McpServerForm = ({ server, onDone }: McpServerFormProps) => {
  const [name, setName] = useState(server?.name ?? '');
  const [url, setUrl] = useState(server?.url ?? '');
  const [headersText, setHeadersText] = useState(
    Object.entries(server?.headers ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
  );
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  /** Validates the URL and headers; returns null and shows the error when either is wrong. */
  const readEndpoint = (): { url: string; headers: Record<string, string> } | null => {
    setError(null);
    setNotice(null);
    const trimmedUrl = url.trim();
    if (!isHttpUrl(trimmedUrl)) {
      setError(t('options_mcp_error_invalidUrl'));
      return null;
    }
    const headers = parseHeaderLines(headersText);
    if (!headers) {
      setError(t('options_mcp_error_invalidHeader'));
      return null;
    }
    return { url: trimmedUrl, headers };
  };

  const handleTest = async () => {
    const endpoint = readEndpoint();
    if (!endpoint) return;
    setTesting(true);
    try {
      const tools = await listMcpTools(endpoint);
      const names = tools.map(tool => tool.name).join(', ') || '-';
      setNotice(t('options_mcp_testOk', [tools.length.toString(), names]));
    } catch (testError) {
      console.error('MCP connection test failed:', testError);
      setError(t('options_mcp_error_testFailed'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const endpoint = readEndpoint();
    if (!endpoint) return;
    if (name.trim() === '') {
      setError(t('options_mcp_error_nameRequired'));
      return;
    }
    try {
      await mcpServersStore.save({
        id: server?.id ?? crypto.randomUUID(),
        name: name.trim(),
        url: endpoint.url,
        headers: endpoint.headers,
        enabled,
      });
      onDone();
    } catch (saveError) {
      console.error('Failed to save MCP server:', saveError);
      setError(t('options_mcp_error_saveFailed'));
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6 text-left shadow-xs">
      <h2 className="text-xl font-semibold text-foreground">
        {server ? t('options_mcp_formEdit') : t('options_mcp_formNew')}
      </h2>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground">{t('options_mcp_fieldName')}</span>
        <input className={INPUT_CLASS} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground">{t('options_mcp_fieldUrl')}</span>
        <input
          className={INPUT_CLASS}
          value={url}
          placeholder="https://example.com/mcp"
          onChange={event => setUrl(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground">{t('options_mcp_fieldHeaders')}</span>
        <textarea
          className={`${INPUT_CLASS} font-mono text-xs`}
          rows={3}
          value={headersText}
          onChange={event => setHeadersText(event.target.value)}
        />
        <span className="mt-1 block text-xs text-muted-foreground">{t('options_mcp_headersHint')}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} className="size-4" />
        {t('options_mcp_enabled')}
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={testing}
          onClick={() => void handleTest()}
          className="bg-secondary px-3 py-1.5 text-xs text-foreground">
          {testing ? t('options_mcp_btnTesting') : t('options_mcp_btnTest')}
        </Button>
        <Button onClick={onDone} className="bg-secondary px-3 py-1.5 text-xs text-foreground">
          {t('options_mcp_btnCancel')}
        </Button>
        <Button
          onClick={() => void handleSave()}
          className="bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
          {t('options_mcp_btnSave')}
        </Button>
      </div>
    </section>
  );
};
