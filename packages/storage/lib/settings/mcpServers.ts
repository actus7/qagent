import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { upsertById } from '../base/collection';

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

const MCP_SERVER_LIMIT = 10;
const MCP_SERVER_LIMIT_ERROR = `MCP server limit reached (${MCP_SERVER_LIMIT}). Remove a server before adding another.`;

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
    await storage.set(prev => ({
      servers: upsertById(prev.servers, server, MCP_SERVER_LIMIT, MCP_SERVER_LIMIT_ERROR),
    }));
  },
  async remove(id: string) {
    await storage.set(prev => ({ servers: prev.servers.filter(server => server.id !== id) }));
  },
};
