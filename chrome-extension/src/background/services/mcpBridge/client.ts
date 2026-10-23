import { MCP_BRIDGE_HANDSHAKE_TIMEOUT_MS } from '@extension/shared';
import { isValidMcpBridgeToken, mcpBridgeStore, type McpBridgeConfig } from '@extension/storage';
import { createLogger } from '../../log';
import { handleBridgeRequest, toBridgeResponse } from './handlers';
import { BridgeHandshake } from './handshake';
import { extractRequestId, parseBridgeRequest } from './protocol';

const logger = createLogger('background');
const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

function endpointKey(config: McpBridgeConfig): string {
  return `${config.host}:${config.port}|${config.token}`;
}

/**
 * Keeps one WebSocket to the local MCP bridge while the setting is on. The bridge is the server;
 * the extension dials out, so no port is opened in the browser. The socket is used only after the
 * mutual HMAC handshake completes (see handshake.ts).
 */
export class McpBridgeClient {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private config: McpBridgeConfig | null = null;
  private key = '';

  apply(config: McpBridgeConfig): void {
    if (!config.enabled) {
      this.stop();
      return;
    }
    if (this.config && this.key === endpointKey(config)) return;
    this.stop();
    if (!isValidMcpBridgeToken(config.token)) {
      logger.warning('MCP bridge not started: the token is missing or shorter than 32 characters');
      return;
    }
    this.config = config;
    this.key = endpointKey(config);
    this.connect();
  }

  stop(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.config = null;
    this.key = '';
    this.attempts = 0;
    socket?.close();
  }

  private connect(): void {
    const config = this.config;
    if (!config) return;
    const socket = new WebSocket(`ws://${config.host}:${config.port}`);
    const handshake = new BridgeHandshake(config.token);
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify(handshake.helloFrame(chrome.runtime.getManifest().version)));
      handshakeTimer = setTimeout(() => {
        if (handshake.isReady()) return;
        logger.warning('MCP bridge handshake timed out');
        socket.close();
      }, MCP_BRIDGE_HANDSHAKE_TIMEOUT_MS);
    };
    socket.onmessage = event => {
      void this.handleFrame(socket, handshake, event.data);
    };
    socket.onclose = () => {
      if (handshakeTimer !== null) clearTimeout(handshakeTimer);
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleRetry();
    };
    // onerror is always followed by onclose, which owns the retry.
  }

  private scheduleRetry(): void {
    if (!this.config) return;
    const delay = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private async handleFrame(socket: WebSocket, handshake: BridgeHandshake, data: unknown): Promise<void> {
    if (typeof data !== 'string') {
      socket.close();
      return;
    }
    const outcome = await handshake.handle(safeJson(data));
    switch (outcome.kind) {
      case 'reply':
        socket.send(JSON.stringify(outcome.frame));
        return;
      case 'ready':
        this.attempts = 0;
        logger.info('MCP bridge connected');
        return;
      case 'dispatch':
        await this.execute(socket, data);
        return;
      case 'drop':
        logger.warning('MCP bridge request dropped: the handshake is not complete');
        return;
      case 'ignore':
        return;
      case 'fail':
        logger.warning(`MCP bridge handshake failed: ${outcome.reason}`);
        socket.close();
        return;
    }
  }

  private async execute(socket: WebSocket, data: string): Promise<void> {
    let response;
    try {
      const request = parseBridgeRequest(data);
      const outcome = await handleBridgeRequest(request).then(
        result => ({ ok: true as const, result }),
        error => ({ ok: false as const, error }),
      );
      response = toBridgeResponse(request.id, outcome);
    } catch (error) {
      const id = extractRequestId(safeJson(data));
      if (!id) {
        logger.error('MCP bridge frame dropped', error);
        return;
      }
      response = toBridgeResponse(id, { ok: false, error });
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const mcpBridgeClient = new McpBridgeClient();

/** Starts the bridge client and follows settings changes. Call once from the service worker root. */
export function registerMcpBridge(): void {
  const apply = async () => {
    mcpBridgeClient.apply(await mcpBridgeStore.getConfig());
  };
  mcpBridgeStore.subscribe(() => void apply());
  void apply();
}
