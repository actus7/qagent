import { describe, expect, it } from 'vitest';
import {
  ChatModelAuthError,
  ChatModelForbiddenError,
  classifyModelError,
  LLMTimeoutError,
  RequestCancelledError,
} from '../agents/errors';

describe('classifyModelError', () => {
  it('returns undefined for an LLM timeout so it counts as a retryable step failure', () => {
    const abortCause = new DOMException('LLM request timeout', 'AbortError');
    const timeout = new LLMTimeoutError('[model] structured output invocation timed out after 45000ms', abortCause);

    expect(classifyModelError(timeout)).toBeUndefined();
  });

  it('maps a user abort to RequestCancelledError', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');

    expect(classifyModelError(abort)).toBeInstanceOf(RequestCancelledError);
  });

  it('maps a 401 to ChatModelAuthError', () => {
    const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 });

    expect(classifyModelError(error)).toBeInstanceOf(ChatModelAuthError);
  });

  it('maps a 403 to ChatModelForbiddenError', () => {
    const error = Object.assign(new Error('Forbidden'), { statusCode: 403 });

    expect(classifyModelError(error)).toBeInstanceOf(ChatModelForbiddenError);
  });

  it('returns undefined for a plain step failure', () => {
    expect(classifyModelError(new Error('Could not parse response'))).toBeUndefined();
  });
});
