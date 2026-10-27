export const LLM_FORBIDDEN_ERROR_MESSAGE =
  'Acesso negado (403 Forbidden). Por favor verifique:\n\n1. Sua chave de API tem as permissões necessárias\n\n2. Para Ollama: Defina OLLAMA_ORIGINS=chrome-extension://* \nveja https://github.com/ollama/ollama/blob/main/docs/faq.md';

export const EXTENSION_CONFLICT_ERROR_MESSAGE = `
  Não é possível acessar uma URL chrome-extension:// de uma extensão diferente.
  
  Isso provavelmente se deve a extensões conflitantes. Por favor, use o QAgent em um novo perfil.`;

/**
 * Custom error class for chat model authentication errors
 */
export class ChatModelAuthError extends Error {
  /**
   * Creates a new ChatModelAuthError
   *
   * @param message - The error message
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatModelAuthError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChatModelAuthError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

export class ChatModelForbiddenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatModelForbiddenError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChatModelForbiddenError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/**
 * Custom error class for chat model bad request errors (400)
 */
export class ChatModelBadRequestError extends Error {
  /**
   * Creates a new ChatModelBadRequestError
   *
   * @param message - The error message
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatModelBadRequestError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChatModelBadRequestError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/** HTTP status carried by AI SDK `APICallError`s (and anything else that exposes `statusCode`). */
export function errorStatusCode(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number') return status;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause && cause !== error ? errorStatusCode(cause) : undefined;
}

/**
 * Checks if an error is related to API authentication
 *
 * @param error - The error to check
 * @returns boolean indicating if it's an authentication error
 */
export function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (errorStatusCode(error) === 401) return true;

  // Get the error message
  const errorMessage = error.message || '';

  // Get error name - sometimes error.name just returns "Error" for custom errors
  let errorName = error.name || '';

  // Try to extract the constructor name, which often contains the actual error type
  // This works better than error.name for many custom errors
  const constructorName = error.constructor?.name;
  if (constructorName && constructorName !== 'Error') {
    errorName = constructorName;
  }

  // Check if the error name indicates an authentication error
  if (errorName === 'AuthenticationError') {
    return true;
  }

  // Fallback: check the message for authentication-related indicators
  return (
    errorMessage.toLowerCase().includes('authentication') ||
    errorMessage.includes(' 401') ||
    errorMessage.toLowerCase().includes('api key')
  );
}

/**
 * Checks if an error is related 403 Forbidden
 *
 * @param error - The error to check
 * @returns boolean indicating if it's an 403 Forbidden error
 */
export function isForbiddenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (errorStatusCode(error) === 403) return true;
  return error.message.includes(' 403') && error.message.includes('Forbidden');
}

/**
 * Checks if an error is related to 400 Bad Request
 *
 * @param error - The error to check
 * @returns boolean indicating if it's a 400 Bad Request error
 */
export function isBadRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (errorStatusCode(error) === 400) return true;

  // Get the error message
  const errorMessage = error.message || '';

  // Get error name - sometimes error.name just returns "Error" for custom errors
  let errorName = error.name || '';

  // Try to extract the constructor name, which often contains the actual error type
  // This works better than error.name for many custom errors
  const constructorName = error.constructor?.name;
  if (constructorName && constructorName !== 'Error') {
    errorName = constructorName;
  }

  // Check if the error name indicates a bad request error
  if (errorName === 'BadRequestError') {
    return true;
  }

  // Check for specific patterns in the error message that indicate bad request
  return (
    errorMessage.includes(' 400') ||
    errorMessage.toLowerCase().includes('badrequest') ||
    errorMessage.includes('Invalid parameter') ||
    (errorMessage.includes('response_format') &&
      errorMessage.includes('json_schema') &&
      errorMessage.includes('not supported'))
  );
}

export function isAbortedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.name === 'AbortError') {
    return true;
  }

  // Match common cancellation message variants, but avoid broad matching on any "aborted" substring.
  const normalizedMessage = error.message.trim().toLowerCase();
  return (
    normalizedMessage === 'aborted' ||
    normalizedMessage.includes('operation was aborted') ||
    normalizedMessage.includes('this operation was aborted')
  );
}

/**
 * Checks if an error is related to extension conflicts
 *
 * @param error - The error to check
 * @returns boolean indicating if it's an extension conflict error
 */
export function isExtensionConflictError(error: unknown): boolean {
  const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return errorMessage.includes('cannot access a chrome-extension') && errorMessage.includes('of different extension');
}

export class RequestCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCancelledError';
  }
}

export class LLMTimeoutError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMTimeoutError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LLMTimeoutError);
    }
  }

  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

export class ExtensionConflictError extends Error {
  /**
   * Creates a new ExtensionConflictError
   *
   * @param message - The error message
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExtensionConflictError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExtensionConflictError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/**
 * Custom error class for when maximum execution steps are reached
 */
export class MaxStepsReachedError extends Error {
  /**
   * Creates a new MaxStepsReachedError
   *
   * @param message - The localized error message (should use t('exec_errors_maxStepsReached'))
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MaxStepsReachedError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MaxStepsReachedError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/**
 * Custom error class for when maximum consecutive failures are reached
 */
export class MaxFailuresReachedError extends Error {
  /**
   * Creates a new MaxFailuresReachedError
   *
   * @param message - The localized error message (should use t('exec_errors_maxFailuresReached'))
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MaxFailuresReachedError';

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MaxFailuresReachedError);
    }
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/**
 * Custom error class for repeated navigation without progress
 */
export class NavigationLoopDetectedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NavigationLoopDetectedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NavigationLoopDetectedError);
    }
  }

  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/**
 * Custom error class for when LLM response cannot be parsed into expected format
 */
export class ResponseParseError extends Error {
  /**
   * Creates a new ResponseParseError
   *
   * @param message - The error message describing the parsing failure
   * @param cause - The original error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ResponseParseError';
  }

  /**
   * Returns a string representation of the error
   */
  toString(): string {
    return `${this.name}: ${this.message}${this.cause ? ` (Caused by: ${this.cause})` : ''}`;
  }
}

/**
 * The error class the executor reacts to, for a provider or transport failure. Undefined for a plain step failure
 * (including an LLM timeout), which the caller counts as a retryable failure. An error already classified is returned as it is.
 */
export function classifyModelError(error: unknown): Error | undefined {
  const message = error instanceof Error ? error.message : String(error);
  // A timeout wraps the SDK's AbortError as its cause, so it would read as a user cancel below
  if (error instanceof LLMTimeoutError) return undefined;
  if (isAuthenticationError(error)) return new ChatModelAuthError(message, error);
  if (isBadRequestError(error)) return new ChatModelBadRequestError(message, error);
  if (isAbortedError(error)) return new RequestCancelledError(message);
  if (error instanceof ExtensionConflictError) return error;
  if (isExtensionConflictError(error)) return new ExtensionConflictError(EXTENSION_CONFLICT_ERROR_MESSAGE, error);
  if (isForbiddenError(error)) return new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
  return undefined;
}

const TROUBLESHOOTING_SUFFIX = /\s*Troubleshooting URL:\s*\S+/gi;

/**
 * Turns provider errors into a short message the user can act on. Known cases get a
 * localized explanation; anything else keeps its text minus any troubleshooting link.
 */
export function describeModelError(error: unknown, translate: (key: ModelErrorKey) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const status = errorStatusCode(error);
  if (isAuthenticationError(error) || lower.includes('model_authentication')) return translate('bg_errors_modelAuth');
  if (isForbiddenError(error) || lower.includes(' 403')) return translate('bg_errors_modelForbidden');
  if (status === 429 || /rate limit|too many requests|\b429\b|quota exceeded/.test(lower)) {
    return translate('bg_errors_modelRateLimit');
  }
  // A 404 only means "model not found" when the provider says so; a page 404 must keep its own text.
  if (lower.includes('model_not_found') || ((status === 404 || /\b404\b/.test(lower)) && lower.includes('model'))) {
    return translate('bg_errors_modelNotFound');
  }
  if (/failed to fetch|fetch failed|econnrefused|enotfound|networkerror|network error/.test(lower)) {
    return translate('bg_errors_modelUnreachable');
  }
  return message.replace(TROUBLESHOOTING_SUFFIX, '').trim();
}

export type ModelErrorKey =
  | 'bg_errors_modelAuth'
  | 'bg_errors_modelForbidden'
  | 'bg_errors_modelRateLimit'
  | 'bg_errors_modelNotFound'
  | 'bg_errors_modelUnreachable';

/**
 * Whether another model could succeed where this call failed: anything except the user cancelling or pausing
 * the task (aborted parent signal), a cancelled request, or a browser-side conflict that no model can fix.
 */
export function shouldTryAnotherModel(error: unknown, taskSignal: AbortSignal): boolean {
  if (taskSignal.aborted) return false;
  if (error instanceof RequestCancelledError || error instanceof ExtensionConflictError) return false;
  if (isExtensionConflictError(error)) return false;
  return true;
}
