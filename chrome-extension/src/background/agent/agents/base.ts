import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import type { BaseMessage } from '@langchain/core/messages';
import { createLogger } from '@src/background/log';
import type { Action } from '../actions/builder';
import { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from '../messages/utils';
import { isAbortedError, LLMTimeoutError, ResponseParseError } from './errors';
import { getDefaultModelRequestsPerMinute, ProviderTypeEnum } from '@extension/storage';
import { acquireRateLimitSlot } from '../rate-limiter';

const logger = createLogger('agent');
const LLM_REQUEST_TIMEOUT_MS = 45_000;
const GEMINI_REQUEST_TIMEOUT_MS = 90_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_RETRY_BASE_MS = 1_500;

function normalizeErrorForLog(error: unknown): { name: string; message: string; stack?: string } | string {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    const details: { name: string; message: string; stack?: string } = {
      name: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : (() => {
              try {
                return JSON.stringify(error);
              } catch {
                return String(error);
              }
            })(),
    };

    if (typeof candidate.stack === 'string') {
      details.stack = candidate.stack;
    }

    return details;
  }

  return String(error);
}

function errorMessageIncludesRateLimit(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('status code 429') ||
    normalized.includes('http 429') ||
    normalized.includes('quota exceeded')
  );
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    if (errorMessageIncludesRateLimit(error.message)) {
      return true;
    }
    return errorMessageIncludesRateLimit(error.stack ?? '');
  }

  if (typeof error === 'string') {
    return errorMessageIncludesRateLimit(error);
  }

  try {
    return errorMessageIncludesRateLimit(JSON.stringify(error));
  } catch {
    return false;
  }
}

function resolveRateLimitRetryDelayMs(error: unknown, attempt: number): number {
  const fallback = RATE_LIMIT_RETRY_BASE_MS * (attempt + 1);
  const message = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error);
  const retryAfterMatch = message.match(/retry[-\s]?after[:=\s]*([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)?/i);
  if (retryAfterMatch) {
    const rawValue = Number.parseFloat(retryAfterMatch[1]);
    const unit = (retryAfterMatch[2] ?? 's').toLowerCase();
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return fallback;
    }
    if (unit.startsWith('ms')) {
      return Math.ceil(rawValue) + 100;
    }
    if (unit.startsWith('m')) {
      return Math.ceil(rawValue * 60_000) + 100;
    }
    return Math.ceil(rawValue * 1_000) + 100;
  }

  return fallback;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallOptions = Record<string, any>;

// Update options to use Zod schema
export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
  prompt: BasePrompt;
  provider?: string;
  requestsPerMinute?: number;
  rateLimitKey?: string;
}
export interface ExtraAgentOptions {
  id?: string;
  toolCallingMethod?: string;
  callOptions?: CallOptions;
}

/**
 * Base class for all agents
 * @param T - The Zod schema for the model output
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: BaseChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected toolCallingMethod: string | null;
  protected chatModelLibrary: string;
  protected modelName: string;
  protected provider: string;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  protected requestsPerMinute?: number;
  protected rateLimitKey: string;
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    // base options
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.provider = options.provider || '';
    // TODO: fix this, the name is not correct in production environment
    this.chatModelLibrary = this.chatLLM.constructor.name;
    this.modelName = this.getModelName();
    this.withStructuredOutput = this.setWithStructuredOutput();
    const normalizedProvider = options.provider?.trim() || ProviderTypeEnum.CustomOpenAI;
    const explicitRequestsPerMinute =
      typeof options.requestsPerMinute === 'number' && Number.isFinite(options.requestsPerMinute)
        ? Math.max(1, Math.round(options.requestsPerMinute))
        : undefined;
    this.requestsPerMinute = explicitRequestsPerMinute ?? getDefaultModelRequestsPerMinute(normalizedProvider, this.modelName);
    this.rateLimitKey = options.rateLimitKey || `${normalizedProvider}:${this.modelName}`;
    // extra options
    this.id = extraOptions?.id || 'agent';
    this.toolCallingMethod = this.setToolCallingMethod(extraOptions?.toolCallingMethod);
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
  }

  protected async invokeWithTimeout<T>(
    invokeFn: (signal: AbortSignal) => Promise<T>,
    operationLabel: string,
  ): Promise<T> {
    const parentSignal = this.context.controller.signal;
    const timeoutMs = this.resolveRequestTimeoutMs(operationLabel);
    const timeoutErrorMessage = `${operationLabel} timed out after ${timeoutMs}ms`;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      if (this.requestsPerMinute && this.requestsPerMinute > 0) {
        await acquireRateLimitSlot({
          key: this.rateLimitKey,
          requestsPerMinute: this.requestsPerMinute,
          signal: parentSignal,
          logger,
          operationLabel,
        });
      }

      const requestController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;

      const onParentAbort = () => {
        requestController.abort(parentSignal.reason);
      };

      if (parentSignal.aborted) {
        onParentAbort();
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            requestController.abort(new DOMException('LLM request timeout', 'AbortError'));
            reject(new LLMTimeoutError(timeoutErrorMessage));
          }, timeoutMs);
        });

        const invokePromise = invokeFn(requestController.signal).catch(error => {
          if (timedOut && isAbortedError(error)) {
            throw new LLMTimeoutError(timeoutErrorMessage, error);
          }
          throw error;
        });

        return await Promise.race([invokePromise, timeoutPromise]);
      } catch (error) {
        if (error instanceof LLMTimeoutError) {
          logger.warning(error.message);
          throw error;
        }

        const shouldRetry = isRateLimitError(error) && attempt < MAX_RATE_LIMIT_RETRIES && !parentSignal.aborted;
        if (shouldRetry) {
          const retryDelayMs = resolveRateLimitRetryDelayMs(error, attempt);
          logger.warning(
            `[${this.modelName}] Rate limit detected. Retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1}).`,
          );
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          continue;
        }

        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }

    throw new Error(`Failed to invoke ${this.modelName}: exhausted rate limit retries`);
  }

  private resolveRequestTimeoutMs(operationLabel: string): number {
    void operationLabel;
    const isGeminiModel = this.modelName.toLowerCase().includes('gemini');

    if (isGeminiModel) {
      return GEMINI_REQUEST_TIMEOUT_MS;
    }

    return LLM_REQUEST_TIMEOUT_MS;
  }

  // Set the model name
  private getModelName(): string {
    if ('modelName' in this.chatLLM) {
      return this.chatLLM.modelName as string;
    }
    if ('model_name' in this.chatLLM) {
      return this.chatLLM.model_name as string;
    }
    if ('model' in this.chatLLM) {
      return this.chatLLM.model as string;
    }
    return 'Unknown';
  }

  // Set the tool calling method
  private setToolCallingMethod(toolCallingMethod?: string): string | null {
    if (toolCallingMethod === 'auto') {
      switch (this.chatModelLibrary) {
        case 'ChatGoogleGenerativeAI':
          return null;
        case 'ChatOpenAI':
        case 'AzureChatOpenAI':
        case 'ChatGroq':
        case 'ChatXAI':
          return 'function_calling';
        default:
          return null;
      }
    }
    return toolCallingMethod || null;
  }

  // Check if model is a Llama model (only for Llama-specific handling)
  private isLlamaModel(modelName: string): boolean {
    return modelName.includes('Llama-4') || modelName.includes('Llama-3.3') || modelName.includes('llama-3.3');
  }

  // Set whether to use structured output based on the model name
  private setWithStructuredOutput(): boolean {
    if (this.modelName === 'deepseek-reasoner' || this.modelName === 'deepseek-r1') {
      return false;
    }

    // Llama API models don't support json_schema response format
    if (this.provider === ProviderTypeEnum.Llama || this.isLlamaModel(this.modelName)) {
      logger.debug(`[${this.modelName}] Llama API doesn't support structured output, using manual JSON extraction`);
      return false;
    }

    return true;
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Use structured output
    if (this.withStructuredOutput) {
      logger.debug(`[${this.modelName}] Preparing structured output call with schema:`, {
        schemaName: this.modelOutputToolName,
        messageCount: inputMessages.length,
        modelProvider: this.provider,
      });

      const structuredLlm = this.chatLLM.withStructuredOutput(this.modelOutputSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      let response = undefined;
      try {
        logger.debug(`[${this.modelName}] Invoking LLM with structured output...`);
        response = await this.invokeWithTimeout(
          signal =>
            structuredLlm.invoke(inputMessages, {
              ...this.callOptions,
              signal,
            }),
          `[${this.modelName}] structured output invocation`,
        );

        logger.debug(`[${this.modelName}] LLM response received:`, {
          hasParsed: !!response.parsed,
          hasRaw: !!response.raw,
          rawContent: response.raw?.content?.slice(0, 500) + (response.raw?.content?.length > 500 ? '...' : ''),
        });

        if (response.parsed) {
          logger.debug(`[${this.modelName}] Successfully parsed structured output`);
          return response.parsed;
        }
        logger.error('Failed to parse response', response);
        throw new Error('Could not parse response with structured output');
      } catch (error) {
        if (error instanceof LLMTimeoutError || isAbortedError(error)) {
          throw error;
        }

        // Try to extract JSON from raw response manually if possible
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('is not valid JSON') &&
          response?.raw?.content &&
          typeof response.raw.content === 'string'
        ) {
          const parsed = this.manuallyParseResponse(response.raw.content);
          if (parsed) {
            return parsed;
          }
        }
        logger.error(`[${this.modelName}] LLM call failed with error: \n${errorMessage}`);
        throw new Error(`Failed to invoke ${this.modelName} with structured output: \n${errorMessage}`);
      }
    }

    // Fallback: Without structured output support, need to extract JSON from model output manually
    logger.debug(`[${this.modelName}] Using manual JSON extraction fallback method`);
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);

    try {
      const response = await this.invokeWithTimeout(
        signal =>
          this.chatLLM.invoke(convertedInputMessages, {
            ...this.callOptions,
            signal,
          }),
        `[${this.modelName}] fallback invocation`,
      );

      if (typeof response.content === 'string') {
        const parsed = this.manuallyParseResponse(response.content);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      const logDetails = normalizeErrorForLog(error);
      if (error instanceof LLMTimeoutError) {
        logger.warning(`[${this.modelName}] LLM call failed in manual extraction mode:`, logDetails);
      } else {
        logger.error(`[${this.modelName}] LLM call failed in manual extraction mode:`, logDetails);
      }
      throw error;
    }
    const errorMessage = `Failed to parse response from ${this.modelName}`;
    logger.error(errorMessage);
    throw new ResponseParseError('Could not parse response');
  }

  // Execute the agent and return the result
  abstract execute(): Promise<AgentOutput<M>>;

  // Helper method to validate metadata
  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    try {
      return this.modelOutputSchema.parse(data);
    } catch (error) {
      logger.error('validateModelOutput', error);
      throw new ResponseParseError('Could not validate model output');
    }
  }

  // Helper method to manually parse the response content
  protected manuallyParseResponse(content: string): this['ModelOutput'] | undefined {
    const cleanedContent = removeThinkTags(content);
    try {
      const extractedJson = extractJsonFromModelOutput(cleanedContent);
      return this.validateModelOutput(extractedJson);
    } catch (error) {
      logger.warning('manuallyParseResponse failed', error);
      return undefined;
    }
  }
}
