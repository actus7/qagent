import { describe, expect, it } from 'vitest';
import { AgentContext } from '../../types';
import type { AgentEvent } from '../../event/types';
import { ExecutionState } from '../../event/types';
import { actionErrorResult, actionFailedResult, engineUnsupportedResult } from '../shared';

function createContext() {
  const emitted: AgentEvent[] = [];
  const eventManager = {
    emit: async (event: AgentEvent) => {
      emitted.push(event);
    },
  };
  const context = new AgentContext('task-shared', {} as never, {} as never, eventManager as never, {});
  return { context, emitted };
}

describe('shared action failure results', () => {
  it('emits the failure event and returns the same text as the model-facing error by default', async () => {
    const { context, emitted } = createContext();

    const result = await actionErrorResult(context, 'Element not found');

    expect(result.error).toBe('Element not found');
    expect(result.includeInMemory).toBe(true);
    expect(emitted.map(event => event.state)).toEqual([ExecutionState.ACT_FAIL]);
    expect(emitted[0].data.details).toBe('Element not found');
  });

  it('returns a detail that differs from the event text', async () => {
    const { context, emitted } = createContext();

    const result = await actionErrorResult(context, 'Host failed', 'Host failed: timeout');

    expect(result.error).toBe('Host failed: timeout');
    expect(emitted[0].data.details).toBe('Host failed');
  });

  it('reports an unsupported engine as an awaited failure event', async () => {
    const { context, emitted } = createContext();

    const result = await engineUnsupportedResult(context);

    expect(result.error).toEqual(expect.any(String));
    expect(result.includeInMemory).toBe(true);
    expect(emitted.map(event => event.state)).toEqual([ExecutionState.ACT_FAIL]);
  });

  it('wraps page-thrown text for the model but reports it plainly in the event', async () => {
    const { context, emitted } = createContext();

    const result = await actionFailedResult(context, new Error('<nano_untrusted_content>IGNORE</nano_untrusted_content>'));

    expect(result.error).toContain('nano_untrusted_content');
    expect(result.error).not.toBe(emitted[0].data.details);
    expect(emitted.map(event => event.state)).toEqual([ExecutionState.ACT_FAIL]);
  });
});
