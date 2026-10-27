import { createLogger } from '../../log';

const logger = createLogger('background');

/** Session storage key the options page reads to show whether the daemon is connected. */
const MCP_BRIDGE_STATUS_KEY = 'mcpBridgeStatus';

export interface McpBridgeStatus {
  connected: boolean;
  updatedAt: number;
}

/** Publishes the connection state. Best effort: the bridge works without the status being visible. */
export async function publishBridgeStatus(connected: boolean): Promise<void> {
  const status: McpBridgeStatus = { connected, updatedAt: Date.now() };
  try {
    await chrome.storage.session.set({ [MCP_BRIDGE_STATUS_KEY]: status });
  } catch (error) {
    logger.warning(`MCP bridge status not published: ${error instanceof Error ? error.message : String(error)}`);
  }
}
