import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContext } from '../../types';

const hostRequest = vi.fn();

vi.mock('../../../services/mcpBridge/hostRelay', () => ({
  hostRequest: (...args: unknown[]) => hostRequest(...args),
}));

const { createShellExecAction, createFsReadAction } = await import('../host');

function fakeContext() {
  const emitEvent = vi.fn();
  return { context: { emitEvent } as unknown as AgentContext, emitEvent };
}

describe('host tool actions', () => {
  beforeEach(() => {
    hostRequest.mockReset();
  });

  it('sends the parameters without the intent and returns the output wrapped as untrusted', async () => {
    hostRequest.mockResolvedValue({ exitCode: 0, stdout: 'qagent-ok\n', stderr: '', timedOut: false });
    const { context, emitEvent } = fakeContext();
    const action = createShellExecAction(context);

    const result = await action.call({ intent: 'check tooling', command: 'echo qagent-ok' });

    expect(hostRequest).toHaveBeenCalledWith('shell_exec', { command: 'echo qagent-ok', timeoutMs: 60000 });
    expect(result.error).toBeNull();
    expect(result.extractedContent).toContain('qagent-ok');
    expect(result.extractedContent).toContain('untrusted');
    expect(emitEvent).toHaveBeenCalledTimes(2);
  });

  it('fails cleanly with the bridge error when the bridge is not connected', async () => {
    hostRequest.mockRejectedValue(new Error('BRIDGE_NOT_CONNECTED: not connected'));
    const { context } = fakeContext();
    const action = createFsReadAction(context);

    const result = await action.call({ path: '/tmp/x.txt' });

    expect(result.extractedContent).toBeNull();
    expect(result.error).toContain('BRIDGE_NOT_CONNECTED');
  });

  it('rejects an empty command before anything is sent', async () => {
    const { context } = fakeContext();
    const action = createShellExecAction(context);
    await expect(action.call({ command: '' })).rejects.toThrow();
    expect(hostRequest).not.toHaveBeenCalled();
  });
});
