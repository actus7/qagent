import { createServer, connect, type AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QAgentMcpBridge } from './bridge';

const TOKEN = 'x'.repeat(32);

function listenOnFreePort(): Promise<{ port: number; close: () => Promise<void> }> {
  const blocker = createServer();
  return new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', () => {
      const { port } = blocker.address() as AddressInfo;
      resolve({ port, close: () => new Promise<void>(done => blocker.close(() => done())) });
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('QAgentMcpBridge start', () => {
  it('listens after an earlier start failed on a busy port', async () => {
    const blocker = await listenOnFreePort();
    const bridge = new QAgentMcpBridge({ token: TOKEN, port: blocker.port });
    await assert.rejects(bridge.start());
    await blocker.close();

    try {
      await bridge.start();
      assert.equal(await canConnect(blocker.port), true);
    } finally {
      await bridge.stop();
    }
  });
});
