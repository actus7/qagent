import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface McpServer {
  id: string;
  name: string;
  /** Streamable HTTP endpoint of a remote MCP server. */
  url: string;
  /** Extra request headers, e.g. Authorization. Stored locally and never shown to the model. */
  headers: Record<string, string>;
  enabled: boolean;
}

export interface McpServersConfig {
  servers: McpServer[];
}

export const MCP_SERVER_LIMIT = 10;

type McpServersStorage = BaseStorage<McpServersConfig> & {
  getAll: () => Promise<McpServer[]>;
  /** Inserts the server, or replaces the stored server with the same id. */
  save: (server: McpServer) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const DEFAULT_MCP_SERVERS: McpServersConfig = { servers: [] };

const storage = createStorage<McpServersConfig>('mcp-servers', DEFAULT_MCP_SERVERS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const mcpServersStore: McpServersStorage = {
  ...storage,
  async getAll() {
    const config = (await storage.get()) || DEFAULT_MCP_SERVERS;
    return config.servers;
  },
  async save(server: McpServer) {
    await storage.set(prev => {
      const exists = prev.servers.some(item => item.id === server.id);
      if (!exists && prev.servers.length >= MCP_SERVER_LIMIT) {
        throw new Error(`MCP server limit reached (${MCP_SERVER_LIMIT}). Remove a server before adding another.`);
      }
      const servers = exists
        ? prev.servers.map(item => (item.id === server.id ? server : item))
        : [...prev.servers, server];
      return { servers };
    });
  },
  async remove(id: string) {
    await storage.set(prev => ({ servers: prev.servers.filter(server => server.id !== id) }));
  },
};
