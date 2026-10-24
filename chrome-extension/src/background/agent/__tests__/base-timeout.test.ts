import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import type { SystemModelMessage, UserModelMessage } from 'ai';
import type * as AiModule from 'ai';
import { generateText } from 'ai';
import { BaseAgent } from '../agents/base';
import type { ChatModel } from '../helper';
import { BasePrompt } from '../prompts/base';
import type { AgentContext, AgentOutput } from '../types';
import { LLMTimeoutError } from '../agents/errors';
import { systemMessage, userMessage } from '../messages/model-messages';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';

vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof AiModule>()), generateText: vi.fn() }));

class TestPrompt extends BasePrompt {
  getSystemMessage(): SystemModelMessage {
    return systemMessage('system');
  }

  async getUserMessage(context: AgentContext): Promise<UserModelMessage> {
    void context;
    return userMessage('user');
  }
}

class TimeoutTestAgent extends BaseAgent<z.ZodAny, never> {
  constructor(context: AgentContext, modelName = 'test-model', chatLLMOverride?: ChatModel) {
    super(z.any(), {
      chatLLM: chatLLMOverride ?? fakeChatModel(modelName),
      context,
      prompt: new TestPrompt(),
    });
  }

  runWithTimeout<T>(invokeFn: (signal: AbortSignal) => Promise<T>, operationLabel = 'test invoke'): Promise<T> {
    return this.invokeWithTimeout(invokeFn, operationLabel);
  }

  async execute(): Promise<AgentOutput<never>> {
    return { id: 'timeout-test' };
  }
}

describe('BaseAgent invokeWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(generateText).mockReset();
  });

  it('throws LLMTimeoutError when model invocation hangs', async () => {
    vi.useFakeTimers();

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new TimeoutTestAgent(context);
    const pendingCall = agent.runWithTimeout(
      () =>
        new Promise<string>(() => {
          // Intentionally unresolved promise to simulate a hung provider request.
        }),
    );

    const timeoutAssertion = expect(pendingCall).rejects.toBeInstanceOf(LLMTimeoutError);
    await vi.advanceTimersByTimeAsync(45_000);
    await timeoutAssertion;
  });

  it('propagates parent abort without converting it to timeout', async () => {
    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new TimeoutTestAgent(context);
    const abortedCall = agent.runWithTimeout(
      signal =>
        new Promise<string>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        }),
    );

    context.controller.abort(new DOMException('User cancelled', 'AbortError'));

    await expect(abortedCall).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('uses extended timeout for Gemini structured output invocations', async () => {
    vi.useFakeTimers();

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new TimeoutTestAgent(context, 'gemini-2.5-flash');
    const pendingCall = agent.runWithTimeout(
      () =>
        new Promise<string>(() => {
          // Intentionally unresolved promise to simulate a hung provider request.
        }),
      '[gemini-2.5-flash] navigator structured output invocation',
    );

    let rejectedEarly = false;
    void pendingCall.catch(() => {
      rejectedEarly = true;
    });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(rejectedEarly).toBe(false);

    await vi.advanceTimersByTimeAsync(45_000);
    await expect(pendingCall).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it('uses extended timeout for Gemini fallback invocations', async () => {
    vi.useFakeTimers();

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    const agent = new TimeoutTestAgent(context, 'gemini-2.5-flash');
    const pendingCall = agent.runWithTimeout(
      () =>
        new Promise<string>(() => {
          // Intentionally unresolved promise to simulate a hung provider request.
        }),
      '[gemini-2.5-flash] fallback invocation',
    );

    let rejectedEarly = false;
    void pendingCall.catch(() => {
      rejectedEarly = true;
    });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(rejectedEarly).toBe(false);

    await vi.advanceTimersByTimeAsync(45_000);
    await expect(pendingCall).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it('keeps LLMTimeoutError type when structured invocation times out', async () => {
    vi.useFakeTimers();

    const context = {
      controller: new AbortController(),
    } as AgentContext;

    vi.mocked(generateText).mockImplementation(
      () =>
        new Promise(() => {
          // Intentionally unresolved promise to simulate a hung provider request.
        }) as never,
    );

    const agent = new TimeoutTestAgent(context, 'test-model');
    const pendingInvoke = agent.invoke([userMessage('test')]);

    const timeoutAssertion = expect(pendingInvoke).rejects.toBeInstanceOf(LLMTimeoutError);
    await vi.advanceTimersByTimeAsync(45_000);
    await timeoutAssertion;
    expect(vi.mocked(generateText).mock.calls[0][0]).toHaveProperty('tools');
  });
});
