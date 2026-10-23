#!/usr/bin/env node
// MCP server entry point: `pnpm mcp:qagent`. Speaks MCP over stdio; stdout carries protocol frames only,
// so every log line goes to stderr.
import { handleJsonRpcPayload, parseJsonRpcLine, splitFrames, type JsonRpcResponse } from './jsonrpc';
import { QAgentMcpBridge } from './bridge';
import { createQaAgentToolHost } from './tools';

const SERVER_INFO = {
  name: 'qagent',
  version: '0.1.0',
  instructions:
    'Drive the QAgent browser extension. qagent_run_task runs a task and waits for the answer; ask permission needs the QAgent side panel open.',
};

function log(message: string): void {
  process.stderr.write(`[qagent-mcp] ${message}\n`);
}

function writeResponse(response: JsonRpcResponse | JsonRpcResponse[]): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function main(): Promise<void> {
  const bridge = QAgentMcpBridge.fromEnv();
  try {
    await bridge.start();
    log(`listening for the QAgent extension on ${bridge.getAddress()}`);
  } catch (error) {
    // Another MCP client may already own the port. Keep serving so the client sees a clear tool error.
    log(`bridge unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const host = createQaAgentToolHost(bridge);
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
      handleLine(frame).catch(error => log(`request failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
  process.stdin.on('end', () => {
    void bridge.stop().finally(() => process.exit(0));
  });
}

void main();
