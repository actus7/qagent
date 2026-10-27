export const JS_RESULT_MAX_CHARS = 10_000;
export const JS_EVALUATION_TIMEOUT_MS = 10_000;

/** The parts of a Runtime.evaluate response that the result formatter reads. */
interface EvaluationResponseLike {
  result: { type: string; value?: unknown; unserializableValue?: string; description?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export interface EvaluationOutcome {
  ok: boolean;
  text: string;
}

export function formatEvaluationResponse(response: EvaluationResponseLike): EvaluationOutcome {
  if (response.exceptionDetails) {
    const reason = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'error';
    return { ok: false, text: truncateResult(reason) };
  }
  const { result } = response;
  if ('value' in result) {
    const serialized = JSON.stringify(result.value);
    return { ok: true, text: truncateResult(serialized ?? String(result.value)) };
  }
  // Values JSON cannot carry (NaN, bigint, DOM nodes, functions) are described instead.
  return { ok: true, text: truncateResult(result.unserializableValue ?? result.description ?? result.type) };
}

export function truncateResult(text: string): string {
  return text.length > JS_RESULT_MAX_CHARS ? `${text.slice(0, JS_RESULT_MAX_CHARS)}...[truncated]` : text;
}

/** Rejects when `work` does not settle in time; `onTimeout` runs first so the caller can stop the work. */
export async function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
