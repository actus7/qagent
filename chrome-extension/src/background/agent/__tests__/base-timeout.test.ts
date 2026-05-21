import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseAgent } from '../agents/base';
import { BasePrompt } from '../prompts/base';
import type { AgentContext, AgentOutput } from '../types';
import { LLMTimeoutError } from '../agents/errors';

class TestPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage('system');
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    void context;
    return new HumanMessage('user');
  }
}

class TimeoutTestAgent extends BaseAgent<z.ZodAny, never> {
  constructor(context: AgentContext, modelName = 'test-model', chatLLMOverride?: BaseChatModel) {
    super(z.any(), {
      chatLLM:
        chatLLMOverride ??
        ({
          constructor: { name: 'TestModel' },
          modelName,
        } as unknown as BaseChatModel),
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

    const structuredInvoke = vi.fn(
      () =>
        new Promise<unknown>(() => {
          // Intentionally unresolved promise to simulate a hung provider request.
        }),
    );
    const chatLLM = {
      constructor: { name: 'TestModel' },
      modelName: 'test-model',
      withStructuredOutput: vi.fn(() => ({
        invoke: structuredInvoke,
      })),
    } as unknown as BaseChatModel;

    const agent = new TimeoutTestAgent(context, 'test-model', chatLLM);
    const pendingInvoke = agent.invoke([new HumanMessage('test')]);

    const timeoutAssertion = expect(pendingInvoke).rejects.toBeInstanceOf(LLMTimeoutError);
    await vi.advanceTimersByTimeAsync(45_000);
    await timeoutAssertion;
  });
});
