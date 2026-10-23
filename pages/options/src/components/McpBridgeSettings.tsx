import { useEffect, useState } from 'react';
import {
  DEFAULT_MCP_BRIDGE_CONFIG,
  isValidMcpBridgeToken,
  mcpBridgeStore,
  type McpBridgeConfig,
} from '@extension/storage';
import { t } from '@extension/i18n';

const toggleClass =
  "peer h-6 w-11 rounded-full bg-input peer-checked:bg-primary peer-focus:ring-4 peer-focus:ring-ring peer-focus:outline-hidden after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-input after:bg-card after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-card";
const inputClass = 'rounded-md border border-input bg-card px-3 py-2 text-foreground';
const buttonClass =
  'rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50';

/** 32 random bytes as 64 hex characters. */
function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Opt-in control of the extension by local MCP clients. Off by default; host is fixed to loopback. */
export const McpBridgeSettings = () => {
  const [config, setConfig] = useState<McpBridgeConfig>(DEFAULT_MCP_BRIDGE_CONFIG);
  const [portDraft, setPortDraft] = useState(String(DEFAULT_MCP_BRIDGE_CONFIG.port));
  const [tokenDraft, setTokenDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void mcpBridgeStore.getConfig().then(loaded => {
      if (!active) return;
      setConfig(loaded);
      setPortDraft(String(loaded.port));
      setTokenDraft(loaded.token);
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async (settings: Partial<McpBridgeConfig>) => {
    try {
      await mcpBridgeStore.updateConfig(settings);
      setConfig(await mcpBridgeStore.getConfig());
    } catch (error) {
      console.error('Failed to save MCP bridge settings:', error);
    }
  };

  const commitPort = () => {
    const port = Number.parseInt(portDraft, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setPortDraft(String(config.port));
      return;
    }
    if (port !== config.port) void save({ port });
  };

  const tokenValid = isValidMcpBridgeToken(tokenDraft);

  const onGenerate = () => {
    const token = generateToken();
    setTokenDraft(token);
    setCopied(false);
    void save({ token });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(tokenDraft);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy MCP bridge token:', error);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-6 text-left shadow-xs">
      <h2 className="mb-2 text-xl font-semibold text-foreground">{t('options_mcp_header')}</h2>
      <p className="mb-4 text-sm font-normal text-muted-foreground">{t('options_mcp_desc')}</p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-foreground">{t('options_mcp_enable')}</h3>
            <p className="text-sm font-normal text-muted-foreground">{t('options_mcp_enable_desc')}</p>
            {!config.enabled && !isValidMcpBridgeToken(config.token) && (
              <p className="text-sm font-normal text-destructive">{t('options_mcp_enable_needs_token')}</p>
            )}
          </div>
          <div className="relative inline-flex cursor-pointer items-center">
            <input
              id="mcpBridgeEnabled"
              type="checkbox"
              checked={config.enabled}
              disabled={!config.enabled && !isValidMcpBridgeToken(config.token)}
              onChange={e => void save({ enabled: e.target.checked })}
              className="peer sr-only"
            />
            <label htmlFor="mcpBridgeEnabled" className={toggleClass}>
              <span className="sr-only">{t('options_mcp_enable')}</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-foreground">{t('options_mcp_address')}</h3>
            <p className="text-sm font-normal text-muted-foreground">{t('options_mcp_address_desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{config.host}</span>
            <label htmlFor="mcpBridgePort" className="sr-only">
              {t('options_mcp_port')}
            </label>
            <input
              id="mcpBridgePort"
              type="number"
              min={1024}
              max={65535}
              value={portDraft}
              onChange={e => setPortDraft(e.target.value)}
              onBlur={commitPort}
              onKeyDown={e => {
                if (e.key === 'Enter') commitPort();
              }}
              className={`w-24 ${inputClass}`}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-medium text-foreground">{t('options_mcp_token')}</h3>
              <p className="text-sm font-normal text-muted-foreground">{t('options_mcp_token_desc')}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label htmlFor="mcpBridgeToken" className="sr-only">
                {t('options_mcp_token')}
              </label>
              <input
                id="mcpBridgeToken"
                type="password"
                autoComplete="off"
                value={tokenDraft}
                onChange={e => {
                  setTokenDraft(e.target.value);
                  setCopied(false);
                }}
                onBlur={() => {
                  if (tokenDraft !== config.token) void save({ token: tokenDraft });
                }}
                className={`w-56 ${inputClass}`}
              />
              <button type="button" className={buttonClass} onClick={onGenerate}>
                {t('options_mcp_token_generate')}
              </button>
              <button type="button" className={buttonClass} onClick={() => void onCopy()} disabled={!tokenDraft}>
                {copied ? t('options_mcp_token_copied') : t('options_mcp_token_copy')}
              </button>
            </div>
          </div>
          {!tokenValid && (
            <p className="text-sm font-normal text-destructive" role="alert">
              {t('options_mcp_token_hint')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-foreground">{t('options_mcp_allow_auto')}</h3>
            <p className="text-sm font-normal text-muted-foreground">{t('options_mcp_allow_auto_desc')}</p>
          </div>
          <div className="relative inline-flex cursor-pointer items-center">
            <input
              id="mcpBridgeAllowAuto"
              type="checkbox"
              checked={config.allowAutoPermission}
              onChange={e => void save({ allowAutoPermission: e.target.checked })}
              className="peer sr-only"
            />
            <label htmlFor="mcpBridgeAllowAuto" className={toggleClass}>
              <span className="sr-only">{t('options_mcp_allow_auto')}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
