import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Opt-in control of the extension by local MCP clients (Claude Code, Codex CLI, ...). Off by default.
export interface McpBridgeConfig {
  enabled: boolean;
  host: string;
  port: number;
  // Shared secret for the HMAC handshake. Stays local: it is never sent raw nor returned to MCP clients.
  token: string;
  // Which CLI agent runs assistant tasks through the daemon; 'off' keeps the built-in agent.
  cliAgent: McpBridgeCliAgent;
}

export type McpBridgeCliAgent = 'off' | 'claude' | 'codex';

export const MCP_BRIDGE_MIN_TOKEN_LENGTH = 32;

export function isValidMcpBridgeToken(token: string): boolean {
  return token.length >= MCP_BRIDGE_MIN_TOKEN_LENGTH;
}

type McpBridgeStorage = BaseStorage<McpBridgeConfig> & {
  getConfig: () => Promise<McpBridgeConfig>;
  updateConfig: (settings: Partial<McpBridgeConfig>) => Promise<void>;
};

export const DEFAULT_MCP_BRIDGE_CONFIG: McpBridgeConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 9224,
  token: '',
  cliAgent: 'off',
};

// The bridge only ever talks to the loopback interface.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function sanitizeMcpBridgeConfig(value: Partial<McpBridgeConfig>): McpBridgeConfig {
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const port = typeof value.port === 'number' && Number.isInteger(value.port) ? value.port : NaN;
  const token = typeof value.token === 'string' ? value.token.trim().slice(0, 256) : '';
  // The bridge cannot be enabled without a token strong enough for the handshake.
  return {
    enabled: value.enabled === true && isValidMcpBridgeToken(token),
    host: LOOPBACK_HOSTS.has(host) ? host : DEFAULT_MCP_BRIDGE_CONFIG.host,
    port: port >= 1024 && port <= 65535 ? port : DEFAULT_MCP_BRIDGE_CONFIG.port,
    token,
    cliAgent: value.cliAgent === 'claude' || value.cliAgent === 'codex' ? value.cliAgent : 'off',
  };
}

const storage = createStorage<McpBridgeConfig>('mcp-bridge-settings', DEFAULT_MCP_BRIDGE_CONFIG, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const mcpBridgeStore: McpBridgeStorage = {
  ...storage,
  async getConfig() {
    return sanitizeMcpBridgeConfig((await storage.get()) ?? DEFAULT_MCP_BRIDGE_CONFIG);
  },
  async updateConfig(settings: Partial<McpBridgeConfig>) {
    const current = await this.getConfig();
    await storage.set(sanitizeMcpBridgeConfig({ ...current, ...settings }));
  },
};
