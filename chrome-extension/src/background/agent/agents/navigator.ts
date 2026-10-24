import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { normalizeActions } from './normalize-actions';
import { createLogger } from '@src/background/log';
import { recordStepScreenshot } from '@src/background/services/step-screenshots';
import { ActionResult, type AgentOutput } from '../types';
import type { Action } from '../actions/builder';
import { buildDynamicActionSchema } from '../actions/builder';
import { agentBrainSchema } from '../types';
import { type ModelMessage, userMessage } from '../messages/model-messages';
import { Actors, ExecutionState } from '../event/types';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  EXTENSION_CONFLICT_ERROR_MESSAGE,
  ExtensionConflictError,
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isExtensionConflictError,
  isForbiddenError,
  LLMTimeoutError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { calcBranchPathHashSet } from '@src/background/browser/dom/views';
import { type BrowserState, BrowserStateHistory, URLNotAllowedError } from '@src/background/browser/views';
import { repairJsonString } from '@src/background/utils';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { AgentStepRecord } from '../history';
import { type DOMHistoryElement } from '@src/background/browser/dom/history/view';

const logger = createLogger('NavigatorAgent');
const MAX_AGENT_STEP_HISTORY_ENTRIES = 300;

interface ParsedModelOutput {
  current_state?: {
    next_goal?: string;
  };
  action?: (Record<string, unknown> | null)[] | null;
}

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  setupModelOutputSchema() {
    const actionSchema = buildDynamicActionSchema(Object.values(this.actions));
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

interface NavigatorResult {
  done: boolean;
}

type NavigatorOutputSchema = ReturnType<NavigatorActionRegistry['setupModelOutputSchema']>;

export class NavigatorAgent extends BaseAgent<NavigatorOutputSchema, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });

    this.actionRegistry = actionRegistry;

    // Gemini often stalls with navigator's large structured schema. Prefer manual JSON extraction for stability.
    if (this.isGeminiModel() && this.withStructuredOutput) {
      this.withStructuredOutput = false;
      logger.info(`[${this.modelName}] Navigator structured output disabled; using manual JSON extraction mode.`);
    }
  }

  private isGeminiModel(): boolean {
    return this.modelName.toLowerCase().includes('gemini');
  }

  private async invokeWithoutStructuredOutput(inputMessages: ModelMessage[]): Promise<this['ModelOutput']> {
    const previousWithStructuredOutput = this.withStructuredOutput;
    this.withStructuredOutput = false;
    try {
      logger.warning(`[${this.modelName}] Structured output timeout. Retrying with manual JSON extraction fallback.`);
      return await super.invoke(inputMessages);
    } finally {
      this.withStructuredOutput = previousWithStructuredOutput;
    }
  }

  async invoke(inputMessages: ModelMessage[]): Promise<this['ModelOutput']> {
    try {
      return await super.invoke(inputMessages);
    } catch (error) {
      // Gemini sometimes stalls on the large navigator tool schema; a plain-text answer still works
      if (error instanceof LLMTimeoutError && this.withStructuredOutput && this.isGeminiModel()) {
        return this.invokeWithoutStructuredOutput(inputMessages);
      }
      throw error;
    }
  }

  /**
   * The tool input is taken as-is instead of being validated against the action schema: some models send `action`
   * as JSON text or wrap items differently, and fixActions() normalizes those shapes before execution.
   */
  protected acceptStructuredOutput(input: unknown): this['ModelOutput'] | undefined {
    if (typeof input !== 'object' || input === null || !('action' in input)) return undefined;
    const parsed = input as ParsedModelOutput;
    return { current_state: parsed.current_state, action: parsed.action } as this['ModelOutput'];
  }

  async execute(): Promise<AgentOutput<NavigatorResult>> {
    const agentOutput: AgentOutput<NavigatorResult> = {
      id: this.id,
    };

    let cancelled = false;
    let modelOutputString: string | null = null;
    let browserStateHistory: BrowserStateHistory | null = null;
    let actionResults: ActionResult[] = [];

    try {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...');
      logger.debug('Navigator execute started', {
        taskId: this.context.taskId,
        step: this.context.nSteps,
        paused: this.context.paused,
        stopped: this.context.stopped,
      });

      const messageManager = this.context.messageManager;
      // add the browser state message
      await this.addStateMessageToMemory();
      const currentState = await this.context.browserContext.getCachedState();
      logger.debug('Navigator cached state captured', {
        url: currentState.url,
        title: currentState.title,
        tabCount: currentState.tabs.length,
      });
      // Screenshots exist only when vision is on. Stored for the HTML report; failures never stop the step.
      if (currentState.screenshot) {
        recordStepScreenshot(this.context.taskId, this.context.nSteps + 1, currentState.screenshot).catch(error =>
          logger.warning('Failed to store step screenshot', error),
        );
      }
      browserStateHistory = new BrowserStateHistory(currentState);

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        logger.info('Navigator cancelled before model invocation', {
          paused: this.context.paused,
          stopped: this.context.stopped,
        });
        cancelled = true;
        return agentOutput;
      }

      // call the model to get the actions to take
      messageManager.cutMessages();
      const inputMessages = messageManager.getMessages();
      logger.debug('Navigator invoking model', {
        model: this.modelName,
        messageCount: inputMessages.length,
        structuredOutput: this.withStructuredOutput,
      });

      const modelOutput = await this.invoke(inputMessages);
      logger.debug('Navigator model output received', modelOutput);

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        logger.info('Navigator cancelled after model invocation', {
          paused: this.context.paused,
          stopped: this.context.stopped,
        });
        cancelled = true;
        return agentOutput;
      }

      const actions = this.fixActions(modelOutput);
      logger.info('Navigator normalized actions', {
        count: actions.length,
        actionNames: actions.map(action => Object.keys(action)[0] ?? 'unknown'),
      });
      modelOutput.action = actions;
      modelOutputString = JSON.stringify(modelOutput);

      // remove the last state message from memory before adding the model output
      this.removeLastStateMessageFromMemory();
      this.addModelOutputToMemory(modelOutput);

      // take the actions
      actionResults = await this.doMultiAction(actions);
      logger.debug('Navigator action execution results', actionResults);
      // prepended so the last result still decides whether the task is done
      actionResults.unshift(...(await this.collectDialogNotices()));

      this.context.actionResults = actionResults;
      this.context.runActions.push(
        ...actionResults.map(result => ({ content: result.extractedContent, error: result.error })),
      );

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        logger.info('Navigator cancelled after action execution', {
          paused: this.context.paused,
          stopped: this.context.stopped,
        });
        cancelled = true;
        return agentOutput;
      }
      // emit event
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Navigation done');
      let done = false;
      if (actionResults.length > 0 && actionResults[actionResults.length - 1].isDone) {
        done = true;
      }
      logger.info('Navigator step completed', {
        done,
        actionResultCount: actionResults.length,
      });
      agentOutput.result = { done };
      return agentOutput;
    } catch (error) {
      this.removeLastStateMessageFromMemory();
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError(errorMessage, error);
      } else if (isBadRequestError(error)) {
        throw new ChatModelBadRequestError(errorMessage, error);
      } else if (isAbortedError(error)) {
        // Real user aborts only; an LLM timeout is a counted, retryable step failure
        throw new RequestCancelledError(errorMessage);
      } else if (isExtensionConflictError(error)) {
        throw new ExtensionConflictError(EXTENSION_CONFLICT_ERROR_MESSAGE, error);
      } else if (error instanceof ExtensionConflictError) {
        // Already localized (for example a debugger conflict raised while attaching the tab)
        throw error;
      } else if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      } else if (error instanceof URLNotAllowedError) {
        throw error;
      }

      const errorString = `Navigation failed: ${errorMessage}`;
      logger.error(errorString, error);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, errorString);
      agentOutput.error = errorMessage;
      return agentOutput;
    } finally {
      // if the task is cancelled, remove the last state message from memory and emit event
      if (cancelled) {
        this.removeLastStateMessageFromMemory();
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled');
      }
      if (browserStateHistory) {
        // Create a copy of actionResults to store in history
        const actionResultsCopy = actionResults.map(result => {
          return new ActionResult({
            isDone: result.isDone,
            success: result.success,
            extractedContent: result.extractedContent,
            error: result.error,
            includeInMemory: result.includeInMemory,
            interactedElement: result.interactedElement,
          });
        });

        const history = new AgentStepRecord(modelOutputString, actionResultsCopy, browserStateHistory);
        this.context.history.history.push(history);
        if (this.context.history.history.length > MAX_AGENT_STEP_HISTORY_ENTRIES) {
          const overflow = this.context.history.history.length - MAX_AGENT_STEP_HISTORY_ENTRIES;
          this.context.history.history.splice(0, overflow);
          logger.debug(
            `Trimmed ${overflow} agent history entr${overflow === 1 ? 'y' : 'ies'} to keep ${MAX_AGENT_STEP_HISTORY_ENTRIES} entries`,
          );
        }
      }
    }
  }

  /**
   * Add the state message to the memory
   */
  public async addStateMessageToMemory() {
    if (this.context.pageStale) {
      // The page may have changed while the user had control: drop the old state and read the page again.
      this.context.pageStale = false;
      await this.removeLastStateMessageFromMemory();
      await this.context.browserContext.getState(this.context.options.useVision);
    } else if (this.context.stateMessageAdded) {
      return;
    }

    const messageManager = this.context.messageManager;
    // Handle results that should be included in memory
    if (this.context.actionResults.length > 0) {
      let index = 0;
      for (const r of this.context.actionResults) {
        if (r.includeInMemory) {
          if (r.extractedContent) {
            messageManager.addMessageWithTokens(userMessage(`Action result: ${r.extractedContent}`));
          }
          if (r.error) {
            // Get error text and convert to string
            const errorText = r.error.toString().trim();

            // Get only the last line of the error
            const lastLine = errorText.split('\n').pop() || '';

            logger.info('Adding action error to memory', lastLine);
            messageManager.addMessageWithTokens(userMessage(`Action error: ${lastLine}`));
          }
          // reset this action result to empty, we dont want to add it again in the state message
          // NOTE: in python version, all action results are reset to empty, but in ts version, only those included in memory are reset to empty
          this.context.actionResults[index] = new ActionResult();
        }
        index++;
      }
    }

    const state = await this.prompt.getUserMessage(this.context);
    messageManager.addStateMessage(state);
    this.context.stateMessageAdded = true;
  }

  /**
   * Remove the last state message from the memory
   */
  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    const messageManager = this.context.messageManager;
    messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async addModelOutputToMemory(modelOutput: this['ModelOutput']) {
    const messageManager = this.context.messageManager;
    messageManager.addModelOutput(modelOutput);
  }

  /**
   * Fix the actions to be an array of objects, sometimes the action is a string or an object
   * @param response
   * @returns
   */
  private fixActions(response: this['ModelOutput']): Record<string, unknown>[] {
    if (!Array.isArray(response.action)) {
      logger.warning('Unexpected action format', response.action);
    }
    let actions: Record<string, unknown>[];
    try {
      actions = normalizeActions(response.action, repairJsonString);
    } catch (error) {
      logger.error('Invalid action format even after repair attempt', response.action);
      throw error;
    }
    if (actions.length === 0) {
      logger.warning('No valid actions found', response.action);
    }
    return actions;
  }

  /**
   * Lets a user cancel stop waiting on a page call that never returns (e.g. a hung puppeteer call).
   */
  private async raceWithCancel<T>(pending: Promise<T>): Promise<T> {
    const signal = this.context.controller.signal;
    const cancelled = () => new RequestCancelledError('Tarefa interrompida.');
    if (signal.aborted) throw cancelled();
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => reject(cancelled());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([pending, abortPromise]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  /** JS dialogs handled by the page since the last step, reported to the model as action results. */
  private async collectDialogNotices(): Promise<ActionResult[]> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      return (page.takeDialogNotices?.() ?? []).map(
        notice => new ActionResult({ extractedContent: notice, includeInMemory: true }),
      );
    } catch (error) {
      logger.warning('Could not collect JS dialog notices', error);
      return [];
    }
  }

  private async doMultiAction(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    let errCount = 0;
    logger.info('Actions', actions);

    const browserContext = this.context.browserContext;
    const browserState = await browserContext.getState(this.context.options.useVision);
    const cachedPathHashes = await calcBranchPathHashSet(browserState);

    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      const actionName = Object.keys(action)[0];
      const actionArgs = action[actionName];
      try {
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }

        const actionInstance = this.actionRegistry.getAction(actionName);
        if (actionInstance === undefined) {
          throw new Error(`Action ${actionName} not exists`);
        }

        const indexArg = actionInstance.getIndexArg(actionArgs);
        if (i > 0 && indexArg !== null) {
          const newState = await browserContext.getState(this.context.options.useVision);
          const newPathHashes = await calcBranchPathHashSet(newState);
          // next action requires index but there are new elements on the page
          if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
            const msg = `Something new appeared after action ${i} / ${actions.length}`;
            logger.info(msg);
            results.push(
              new ActionResult({
                extractedContent: msg,
                includeInMemory: true,
              }),
            );
            break;
          }
        }

        const result = await this.raceWithCancel(actionInstance.call(actionArgs));
        if (result === undefined) {
          throw new Error(`Action ${actionName} returned undefined`);
        }
        if (!result.error) {
          result.success = true;
        }

        // if the action has an index argument, record the interacted element to the result
        if (indexArg !== null) {
          const domElement = browserState.selectorMap.get(indexArg);
          if (domElement) {
            const interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);
            result.interactedElement = interactedElement;
            logger.info('Interacted element', interactedElement);
            logger.info('Result', result);
          }
        }
        results.push(result);

        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
        // TODO: wait for 1 second for now, need to optimize this to avoid unnecessary waiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        if (error instanceof URLNotAllowedError || error instanceof RequestCancelledError || this.context.stopped) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'doAction error',
          actionName,
          JSON.stringify(actionArgs, null, 2),
          JSON.stringify(errorMessage, null, 2),
        );
        // unexpected error, emit event
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMessage);
        errCount++;
        if (errCount > 3) {
          throw new Error('Too many errors in actions', { cause: error });
        }
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
      }
    }
    return results;
  }

  /**
   * Parse and validate model output from history item
   */
  private parseHistoryModelOutput(historyItem: AgentStepRecord): {
    parsedOutput: ParsedModelOutput;
    goal: string;
    actionsToReplay: (Record<string, unknown> | null)[] | null;
  } {
    if (!historyItem.modelOutput) {
      throw new Error('No model output found in history item');
    }

    let parsedOutput: ParsedModelOutput;
    try {
      parsedOutput = JSON.parse(historyItem.modelOutput) as ParsedModelOutput;
    } catch (error) {
      throw new Error(`Could not parse modelOutput: ${error}`, { cause: error });
    }

    const goal = parsedOutput?.current_state?.next_goal || '';
    const actionsToReplay = parsedOutput?.action;

    // Validate that there are actions to replay
    if (
      !parsedOutput || // No model output string at all
      !actionsToReplay || // 'action' field is missing or null after parsing
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 0) || // 'action' is an empty array
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 1 && actionsToReplay[0] === null) // 'action' is [null]
    ) {
      throw new Error('No action to replay');
    }

    return { parsedOutput, goal, actionsToReplay };
  }

  /**
   * Execute actions from history with element index updates
   */
  private async executeHistoryActions(
    parsedOutput: ParsedModelOutput,
    historyItem: AgentStepRecord,
    delay: number,
  ): Promise<ActionResult[]> {
    const state = await this.context.browserContext.getState(this.context.options.useVision);
    if (!state) {
      throw new Error('Invalid browser state');
    }

    const updatedActions: (Record<string, unknown> | null)[] = [];
    for (let i = 0; i < parsedOutput.action!.length; i++) {
      const result = historyItem.result[i];
      if (!result) {
        break;
      }
      const interactedElement = result.interactedElement;
      const currentAction = parsedOutput.action![i];

      // Skip null actions
      if (currentAction === null) {
        updatedActions.push(null);
        continue;
      }

      // If there's no interacted element, just use the action as is
      if (!interactedElement) {
        updatedActions.push(currentAction);
        continue;
      }

      const updatedAction = await this.updateActionIndices(interactedElement, currentAction, state);
      updatedActions.push(updatedAction);

      if (updatedAction === null) {
        throw new Error(`Could not find matching element ${i} in current page`);
      }
    }

    logger.debug('updatedActions', updatedActions);

    // Filter out null values and cast to the expected type
    const validActions = updatedActions.filter((action): action is Record<string, unknown> => action !== null);
    const result = await this.doMultiAction(validActions);

    // Wait for the specified delay
    await new Promise(resolve => setTimeout(resolve, delay));
    return result;
  }

  async executeHistoryStep(
    historyItem: AgentStepRecord,
    stepIndex: number,
    totalSteps: number,
    maxRetries = 3,
    delay = 1000,
    skipFailures = true,
  ): Promise<ActionResult[]> {
    const replayLogger = createLogger('NavigatorAgent:executeHistoryStep');
    const results: ActionResult[] = [];

    // Parse and validate model output
    let parsedData: {
      parsedOutput: ParsedModelOutput;
      goal: string;
      actionsToReplay: (Record<string, unknown> | null)[] | null;
    };
    try {
      parsedData = this.parseHistoryModelOutput(historyItem);
    } catch (error) {
      const errorMsg = `Step ${stepIndex + 1}: ${error instanceof Error ? error.message : String(error)}`;
      replayLogger.warning(errorMsg);
      return [
        new ActionResult({
          error: errorMsg,
          includeInMemory: false,
        }),
      ];
    }

    const { parsedOutput, goal, actionsToReplay } = parsedData;
    replayLogger.info(`Replaying step ${stepIndex + 1}/${totalSteps}: goal: ${goal}`);
    replayLogger.debug(`🔄 Replaying actions:`, actionsToReplay);

    // Try to execute the step with retries
    let retryCount = 0;
    let success = false;

    while (retryCount < maxRetries && !success) {
      try {
        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history actions
        const stepResults = await this.executeHistoryActions(parsedOutput, historyItem, delay);
        results.push(...stepResults);
        success = true;
      } catch (error) {
        retryCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (retryCount >= maxRetries) {
          const failMsg = `Step ${stepIndex + 1} failed after ${maxRetries} attempts: ${errorMessage}`;
          replayLogger.error(failMsg);

          results.push(
            new ActionResult({
              error: failMsg,
              includeInMemory: true,
            }),
          );

          if (!skipFailures) {
            throw new Error(failMsg, { cause: error });
          }
        } else {
          replayLogger.warning(`Step ${stepIndex + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`);
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return results;
  }

  async updateActionIndices(
    historicalElement: DOMHistoryElement,
    action: Record<string, unknown>,
    currentState: BrowserState,
  ): Promise<Record<string, unknown> | null> {
    // If no historical element or no element tree in current state, return the action unchanged
    if (!historicalElement || !currentState.elementTree) {
      return action;
    }

    // Find the current element in the tree based on the historical element
    const currentElement = await HistoryTreeProcessor.findHistoryElementInTree(
      historicalElement,
      currentState.elementTree,
    );

    // If no current element found or it doesn't have a highlight index, return null
    if (!currentElement || currentElement.highlightIndex === null) {
      return null;
    }

    // Get action name and args
    const actionName = Object.keys(action)[0];
    const actionArgs = action[actionName] as Record<string, unknown>;

    // Get the action instance to access the index
    const actionInstance = this.actionRegistry.getAction(actionName);
    if (!actionInstance) {
      return action;
    }

    // Get the index argument from the action
    const oldIndex = actionInstance.getIndexArg(actionArgs);

    // If the index has changed, update it
    if (oldIndex !== null && oldIndex !== currentElement.highlightIndex) {
      // Create a new action object with the updated index
      const updatedAction: Record<string, unknown> = { [actionName]: { ...actionArgs } };

      // Update the index in the action arguments
      actionInstance.setIndexArg(updatedAction[actionName] as Record<string, unknown>, currentElement.highlightIndex);

      logger.info(`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`);
      return updatedAction;
    }

    return action;
  }
}
