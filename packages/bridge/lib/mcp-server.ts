// MCP server over stdio: `qagent mcp`. Stdout carries protocol frames only, so every log line goes to stderr.
// When a daemon runs, the server forwards to it over the control channel; otherwise it starts a bridge in-process.
import { QAgentMcpBridge, type ExtensionHandler } from './bridge';
import { ControlClient } from './control';
import { createExtensionHandler } from './daemon';
import { handleJsonRpcPayload, parseJsonRpcLine, splitFrames, type JsonRpcResponse } from './jsonrpc';
import { CliTaskRunner } from './cli/runner';
import { CONTROL_DEFAULT_PORT, MCP_BRIDGE_DEFAULT_HOST, MCP_BRIDGE_DEFAULT_PORT } from './protocol';
import { readToken, stateDirFrom } from './config';
import { createQaAgentToolHost, type BridgeRequester } from './tools';
import { readToolsCache, writeToolsCache } from './tools-cache';
import { PACKAGE_VERSION } from './version';
import { join } from 'node:path';

const SERVER_INFO = {
  name: 'qagent',
  version: PACKAGE_VERSION,
  instructions:
    'Drive the QAgent browser extension. page_* tools act on the page (page_info, page_click, page_fill, ...). ' +
    'qagent_run_task runs a whole task in the extension and waits for the answer.',
};

function log(message: string): void {
  process.stderr.write(`[qagent-mcp] ${message}\n`);
}

function writeResponse(response: JsonRpcResponse | JsonRpcResponse[]): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function notifyToolsChanged(): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n`);
}

/**
 * Picks the daemon when one answers, else starts a bridge in this process.
 * `onExtensionConnected` only fires for the in-process bridge: a daemon owns the extension connection.
 */
export async function connectRequester(
  env: NodeJS.ProcessEnv = process.env,
  onExtensionConnected?: () => void,
): Promise<BridgeRequester> {
  const token = readToken(env);
  if (!token) throw new Error('No token configured. Run "qagent pair" to create one.');
  const port = Number.parseInt(env.QAGENT_CONTROL_PORT ?? String(CONTROL_DEFAULT_PORT), 10);
  const control = new ControlClient(port, token);
  try {
    await control.status();
    log(`using the running daemon on control port ${port}`);
    return control;
  } catch {
    log('no daemon answered; starting a bridge in this process');
  }
  const bridgePort = Number.parseInt(env.QAGENT_MCP_PORT ?? String(MCP_BRIDGE_DEFAULT_PORT), 10);
  const cli = new CliTaskRunner({
    stateDir: stateDirFrom(env),
    binPath: join(__dirname, 'bin.js'),
  });
  const handler: ExtensionHandler = createExtensionHandler(cli);
  const bridge = new QAgentMcpBridge({
    token,
    host: env.QAGENT_MCP_HOST?.trim() || MCP_BRIDGE_DEFAULT_HOST,
    port: Number.isFinite(bridgePort) ? bridgePort : MCP_BRIDGE_DEFAULT_PORT,
    handler,
    onExtensionConnected,
  });
  try {
    await bridge.start();
    log(`listening for the QAgent extension on ${bridge.getAddress()}`);
  } catch (error) {
    // Another process may own the port. Keep serving so the client sees clear tool errors.
    log(`bridge unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return bridge;
}

export async function runMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // The bridge may connect before the host exists; the callback reads refreshTools once it is set.
  let refreshTools = (): void => {};
  let requester: BridgeRequester;
  try {
    requester = await connectRequester(env, () => refreshTools());
  } catch (error) {
    // Without a token the extension cannot be authenticated: refuse to run open.
    log(`not started: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  const host = createQaAgentToolHost(requester, {
    cachedCatalog: readToolsCache(env),
    saveCatalog: entries => {
      try {
        writeToolsCache(entries, env);
      } catch (error) {
        log(`could not save the tools cache: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
  refreshTools = () => {
    void host.refreshActions().then(changed => {
      if (changed) notifyToolsChanged();
    });
  };
  let buffer = '';

  const handleLine = async (line: string): Promise<void> => {
    const parsed = parseJsonRpcLine(line);
    if (!parsed.ok) {
      writeResponse(parsed.response);
      return;
    }
    const response = await handleJsonRpcPayload(parsed.message, host, SERVER_INFO);
    if (response) writeResponse(response);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    const { frames, rest } = splitFrames(buffer + chunk);
    buffer = rest;
    for (const frame of frames) {
      // Requests run concurrently: a long run_task must not block tools/call for cancel_task.
      handleLine(frame).catch(error =>
        log(`request failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  });
  process.stdin.on('end', () => {
    process.exit(0);
  });
}
