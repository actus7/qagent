import type { z } from 'zod';
import { generateText, jsonSchema, tool, ToolChoiceViolationError, type JSONSchema7 } from 'ai';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import type { ModelMessage } from '../messages/model-messages';
import type { ChatModel } from '../helper';
import { createLogger } from '@src/background/log';
import { convertZodToJsonSchema } from '@src/background/utils';
import type { Action } from '../actions/builder';
import { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from '../messages/utils';
import { errorStatusCode, isAbortedError, LLMTimeoutError, ResponseParseError, shouldTryAnotherModel } from './errors';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../event/types';
import { getDefaultModelRequestsPerMinute, ProviderTypeEnum } from '@extension/storage';
import { acquireRateLimitSlot } from '../rate-limiter';
import { runWithFailover } from '../model-failover';

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
  if (errorStatusCode(error) === 429) return true;

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
  const retryAfterMatch = message.match(
    /retry[-\s]?after[:=\s]*([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)?/i,
  );
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
type CallOptions = Record<string, any>;

export interface BaseAgentOptions {
  chatLLM: ChatModel;
  context: AgentContext;
  prompt: BasePrompt;
  provider?: string;
  requestsPerMinute?: number;
  rateLimitKey?: string;
}
export interface ExtraAgentOptions {
  id?: string;
  callOptions?: CallOptions;
}

const MAX_LOGGED_CONTENT_CHARS = 2000;

/** The response content as one truncated string for the log. */
function describeContent(content: ReadonlyArray<{ type: string; text?: string; input?: unknown }>): string {
  const text = content
    .map(part =>
      part.type === 'tool-call' ? `[tool-call] ${JSON.stringify(part.input)}` : `[${part.type}] ${part.text ?? ''}`,
    )
    .join('\n');
  return text.length > MAX_LOGGED_CONTENT_CHARS ? `${text.slice(0, MAX_LOGGED_CONTENT_CHARS)}…` : text;
}

/**
 * Base class for all agents
 * @param T - The Zod schema for the model output
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: ChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected modelName: string;
  protected provider: string;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  protected structuredTools?: Record<string, ReturnType<typeof tool>>;
  protected requestsPerMinute?: number;
  protected rateLimitKey: string;
  /** The model the agent was built with; its options (rate limit) came from the slot configuration. */
  private configured: { model: ChatModel; requestsPerMinute?: number; rateLimitKey: string };
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    // base options
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.provider = options.provider || '';
    this.modelName = this.chatLLM.modelName || 'Unknown';
    this.withStructuredOutput = this.setWithStructuredOutput();
    const normalizedProvider = options.provider?.trim() || ProviderTypeEnum.CustomOpenAI;
    const explicitRequestsPerMinute =
      typeof options.requestsPerMinute === 'number' && Number.isFinite(options.requestsPerMinute)
        ? Math.max(1, Math.round(options.requestsPerMinute))
        : undefined;
    this.requestsPerMinute =
      explicitRequestsPerMinute ?? getDefaultModelRequestsPerMinute(normalizedProvider, this.modelName);
    this.rateLimitKey = options.rateLimitKey || `${normalizedProvider}:${this.modelName}`;
    this.configured = {
      model: this.chatLLM,
      requestsPerMinute: this.requestsPerMinute,
      rateLimitKey: this.rateLimitKey,
    };
    // extra options
    this.id = extraOptions?.id || 'agent';
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
  }

  protected async invokeWithTimeout<T>(
    invokeFn: (signal: AbortSignal) => Promise<T>,
    operationLabel: string,
  ): Promise<T> {
    const parentSignal = this.context.controller.signal;
    const timeoutMs = this.resolveRequestTimeoutMs();
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

  private resolveRequestTimeoutMs(): number {
    const isGeminiModel = this.modelName.toLowerCase().includes('gemini');

    if (isGeminiModel) {
      return GEMINI_REQUEST_TIMEOUT_MS;
    }

    return LLM_REQUEST_TIMEOUT_MS;
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

    // Llama API models don't support tool calling for structured output
    if (this.provider === ProviderTypeEnum.Llama || this.isLlamaModel(this.modelName)) {
      logger.debug(`[${this.modelName}] Llama API doesn't support structured output, using manual JSON extraction`);
      return false;
    }

    return true;
  }

  /** Options shared by every call: the model, its sampling settings, our own retry policy. */
  private baseCallOptions(chatModel: ChatModel, messages: ModelMessage[], signal: AbortSignal) {
    return {
      model: chatModel.model,
      ...chatModel.settings,
      ...this.callOptions,
      messages,
      // the history starts with the agent's system prompt
      allowSystemInMessages: true,
      abortSignal: signal,
      // ponytail: rate limits are retried by invokeWithTimeout; the SDK's own retries would hide inside the timeout
      maxRetries: 0,
    };
  }

  /**
   * Calls the model; when it fails and other models are configured, each one is tried in turn (ModelFailover).
   * The model that answers stays in use and becomes the slot's configured model; when all fail, the
   * configured default is restored and the first error is thrown. User cancellation is never retried.
   */
  async invoke(inputMessages: ModelMessage[]): Promise<this['ModelOutput']> {
    return runWithFailover(this.chatLLM, model => this.invokeChatModel(inputMessages, model), {
      shouldTryNext: error => shouldTryAnotherModel(error, this.context.controller.signal),
      onSwitch: model => {
        logger.warning(`[${this.modelName}] failed; trying ${model.provider}:${model.modelName}`);
        this.switchModel(model);
      },
      onSwitched: model =>
        this.context.emitEvent(
          // shown in the chat as an activity line (system events only carry task states)
          Actors.NAVIGATOR,
          ExecutionState.ACT_OK,
          t('exec_model_switched', [`${model.provider}:${model.modelName}`]),
        ),
    });
  }

  /** Points the agent at another model, recomputing what depends on the model name. */
  protected switchModel(model: ChatModel): void {
    this.chatLLM = model;
    this.modelName = model.modelName || 'Unknown';
    this.provider = model.provider;
    this.withStructuredOutput = this.setWithStructuredOutput();
    if (model === this.configured.model) {
      this.requestsPerMinute = this.configured.requestsPerMinute;
      this.rateLimitKey = this.configured.rateLimitKey;
    } else {
      this.requestsPerMinute = getDefaultModelRequestsPerMinute(model.provider, this.modelName);
      this.rateLimitKey = `${model.provider}:${this.modelName}`;
    }
    this.onModelChanged();
  }

  /** Hook for agents whose settings depend on the model (e.g. Gemini without structured output). */
  protected onModelChanged(): void {}

  /** One call with `chatModel`, the candidate the failover picked (it is also the model in use). */
  private async invokeChatModel(inputMessages: ModelMessage[], chatModel: ChatModel): Promise<this['ModelOutput']> {
    // Structured output: one tool the model is forced to call, so OpenAI-compatible routers that reject
    // response_format json_schema still work. The tool input is validated by the agent, not by the SDK.
    if (this.withStructuredOutput) {
      logger.debug(`[${this.modelName}] Preparing structured output call with schema:`, {
        schemaName: this.modelOutputToolName,
        messageCount: inputMessages.length,
        modelProvider: this.provider,
      });

      const toolName = this.modelOutputToolName;
      // the schema never changes after construction; converting ~35 action schemas per call is wasted work
      this.structuredTools ??= {
        [toolName]: tool({
          description: 'The agent output.',
          inputSchema: jsonSchema(convertZodToJsonSchema(this.modelOutputSchema, toolName) as JSONSchema7),
        }),
      };
      const tools = this.structuredTools;

      try {
        const result = await this.invokeWithTimeout(
          signal =>
            generateText({
              ...this.baseCallOptions(chatModel, inputMessages, signal),
              tools,
              toolChoice: { type: 'tool', toolName },
            }),
          `[${this.modelName}] structured output invocation`,
        );
        const text = result.text;
        const call = result.toolCalls.find(item => item.toolName === toolName && !item.invalid);
        logger.debug(`[${this.modelName}] LLM response received:`, {
          hasToolCall: Boolean(call),
          text: text.slice(0, 500) + (text.length > 500 ? '...' : ''),
        });

        const output = call ? this.acceptStructuredOutput(call.input) : undefined;
        if (output) {
          logger.debug(`[${this.modelName}] Successfully parsed structured output`);
          return output;
        }
        // no (valid) tool call; the text may still contain a valid JSON answer
        const manuallyParsed = text.length > 0 ? this.manuallyParseResponse(text) : undefined;
        if (manuallyParsed) {
          return manuallyParsed;
        }
        logger.error('Failed to parse response', { toolCalls: result.toolCalls, text });
        throw new Error('Could not parse response with structured output');
      } catch (error) {
        if (error instanceof LLMTimeoutError || isAbortedError(error)) {
          throw error;
        }

        // The model ignored the forced tool: it may still have answered as JSON text or called a tool under
        // another name (e.g. the "AgentOutput" example in its history). Read the answer from the content.
        if (ToolChoiceViolationError.isInstance(error)) {
          const recovered = this.recoverFromToolChoiceViolation(error.content);
          if (recovered) {
            logger.warning(`[${this.modelName}] Tool choice ignored; recovered the output from the response content`);
            return recovered;
          }
          // keep the raw answer in the log; without it the failure cannot be diagnosed
          logger.error(
            `[${this.modelName}] Tool choice ignored and the response content holds no valid output:\n${describeContent(error.content)}`,
          );
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[${this.modelName}] LLM call failed with error: \n${errorMessage}`);
        throw new Error(`Failed to invoke ${this.modelName} with structured output: \n${errorMessage}`, {
          cause: error,
        });
      }
    }

    // Fallback: Without structured output support, need to extract JSON from model output manually
    logger.debug(`[${this.modelName}] Using manual JSON extraction fallback method`);
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);

    try {
      const response = await this.invokeWithTimeout(
        signal => generateText(this.baseCallOptions(chatModel, convertedInputMessages, signal)),
        `[${this.modelName}] fallback invocation`,
      );

      const parsed = this.manuallyParseResponse(response.text);
      if (parsed) {
        return parsed;
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

  /** Output from a response that did not call the forced tool: any tool call's input first, then the text. */
  private recoverFromToolChoiceViolation(
    content: ReadonlyArray<{ type: string; text?: string; input?: unknown }>,
  ): this['ModelOutput'] | undefined {
    for (const part of content) {
      if (part.type !== 'tool-call') continue;
      try {
        const input = typeof part.input === 'string' ? JSON.parse(part.input) : part.input;
        const output = this.acceptStructuredOutput(input);
        if (output) return output;
      } catch (error) {
        logger.warning('Could not read the tool call from the response content', error);
      }
    }
    const text = content
      .filter(part => part.type === 'text')
      .map(part => part.text ?? '')
      .join('');
    return text.trim() ? this.manuallyParseResponse(text) : undefined;
  }

  /** Turns the forced tool call's input into the model output; agents may accept looser shapes than the schema. */
  protected acceptStructuredOutput(input: unknown): this['ModelOutput'] | undefined {
    return this.validateModelOutput(input);
  }

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
