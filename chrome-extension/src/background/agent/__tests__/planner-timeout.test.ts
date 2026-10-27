import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AiModule from 'ai';
import { generateText } from 'ai';
import { PlannerAgent } from '../agents/planner';
import { LLMTimeoutError } from '../agents/errors';
import type { AgentContext } from '../types';
import { systemMessage, userMessage } from '../messages/model-messages';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';

vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof AiModule>()), generateText: vi.fn() }));

function createPlanner() {
  const emitEvent = vi.fn().mockResolvedValue(undefined);
  const context = {
    controller: new AbortController(),
    emitEvent,
    messageManager: { getMessages: () => [userMessage('task'), userMessage('state')] },
    options: { useVision: false, useVisionForPlanner: false },
  } as unknown as AgentContext;
  const prompt = {
    getSystemMessage: () => systemMessage('planner system'),
    getUserMessage: async () => userMessage('state'),
  };
  const planner = new PlannerAgent({
    chatLLM: fakeChatModel('planner-model'),
    context,
    prompt: prompt as never,
  });
  return { planner, emitEvent };
}

describe('PlannerAgent timeouts', () => {
  afterEach(() => vi.mocked(generateText).mockReset());

  it('returns the timeout as a step error instead of cancelling the planner', async () => {
    vi.mocked(generateText).mockRejectedValue(new LLMTimeoutError('[planner-model] structured output timed out'));
    const { planner, emitEvent } = createPlanner();

    const output = await planner.execute();

    expect(output.error).toContain('timed out');
    expect(output.result).toBeUndefined();
    expect(emitEvent).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.stringContaining('timed out'));
  });
});
