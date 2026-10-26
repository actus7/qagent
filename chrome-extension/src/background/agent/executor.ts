import type { ChatModel } from './helper';
import { type ActionResult, AgentContext, type AgentOptions, type AgentOutput } from './types';
import type { TaskMemoryAction } from './task-memory';
import { t } from '@extension/i18n';
import { NavigatorAgent, NavigatorActionRegistry } from './agents/navigator';
import { PlannerAgent, type PlannerOutput } from './agents/planner';
import { NavigatorPrompt } from './prompts/navigator';
import { PlannerPrompt } from './prompts/planner';
import { createLogger } from '@src/background/log';
import MessageManager, { MessageManagerSettings } from './messages/service';
import type { BrowserContextLike } from '../browser/types';
import { ActionBuilder } from './actions/builder';
import { EventManager } from './event/manager';
import { Actors, type EventCallback, EventType, ExecutionState } from './event/types';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  ExtensionConflictError,
  NavigationLoopDetectedError,
  RequestCancelledError,
  MaxStepsReachedError,
  MaxFailuresReachedError,
  describeModelError,
} from './agents/errors';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import type { AgentStepHistory } from './history';
import {
  browserPluginsStore,
  DEFAULT_JEV_CONFIG,
  jevStore,
  workflowsStore,
  type GeneralSettingsConfig,
} from '@extension/storage';
import { decideWithJev, isJevFeatureOn, type JevRuntime } from '@src/background/services/jev/runtime';
import { JevTaskMetrics } from '@src/background/services/jev/metrics';
import {
  buildDoneCheckFinalAnswer,
  buildDoneCheckRequest,
  decideDoneCheck,
} from '@src/background/services/jev/done-check';
import { buildPlannerSkipRequest, decidePlannerSkip } from '@src/background/services/jev/planner-skip';
import {
  actionNamesForGroups,
  hostOf,
  buildToolRoutingRequest,
  selectActionGroups,
} from '@src/background/services/jev/tool-routing';
import {
  buildPluginRoutingRequest,
  buildRoutingCandidates,
  decidePluginRouting,
  pluginHintText,
} from '@src/background/services/jev/plugin-routing';
import { analytics } from '../services/analytics';
import { createLoopDetectionState, evaluateLoopDetection, type LoopDetectionState } from './loop-detection';
import { isManagedProviderAllowed, type AssistantAttachment } from '@extension/shared';
import { getManagedPolicy } from '../state/managedPolicyState';
import { buildImageContentParts, indexFileAttachments } from '../services/assistant-attachments';
import { isSimpleTask, reportStyleFor, type ReportStyle } from './task-kind';
import { userMessage } from './messages/model-messages';

const logger = createLogger('Executor');
const MAX_TASK_CHAIN_LENGTH = 50;
const PAUSE_POLL_INTERVAL_MS = 200;
// Jev done-check sees the last few action results and a bounded page text, so its question stays small
const DONE_CHECK_RESULTS = 5;
const DONE_CHECK_PAGE_CHARS = 4000;
// The system prompt is built from the first task, so a QA follow-up needs its own note for the full report.
const QA_FOLLOW_UP_NOTE =
  'This follow-up is a QA/test request: in the done action, give the full structured QA report (Relatório Final) described in the system instructions, and a complete final_answer.';

interface ExecutorExtraArgs {
  plannerLLM?: ChatModel;
  navigatorProvider?: string;
  plannerProvider?: string;
  navigatorRequestsPerMinute?: number;
  plannerRequestsPerMinute?: number;
  navigatorRateLimitKey?: string;
  plannerRateLimitKey?: string;
  agentOptions?: Partial<AgentOptions>;
  generalSettings?: GeneralSettingsConfig;
  attachments?: AssistantAttachment[];
}

export class Executor {
  private readonly navigator: NavigatorAgent;
  private readonly planner: PlannerAgent;
  private readonly context: AgentContext;
  private readonly plannerPrompt: PlannerPrompt;
  private readonly navigatorPrompt: NavigatorPrompt;
  private readonly generalSettings: GeneralSettingsConfig | undefined;
  private loopDetectionState: LoopDetectionState = createLoopDetectionState();
  private plannerDisabledForTask = false;
  private readonly reportStyle: ReportStyle;
  private tasks: string[] = [];
  private jevRuntime: JevRuntime | null = null;
  private routedHost: string | null = null;
  private toolsRestricted = false;
  private readonly allActionNames: string[];
  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContextLike,
    navigatorLLM: ChatModel,
    extraArgs?: Partial<ExecutorExtraArgs>,
  ) {
    const messageManager = new MessageManager(
      new MessageManagerSettings({
        maxInputTokens: extraArgs?.agentOptions?.maxInputTokens,
      }),
    );

    const plannerLLM = extraArgs?.plannerLLM ?? navigatorLLM;
    const eventManager = new EventManager();
    const context = new AgentContext(
      taskId,
      browserContext,
      messageManager,
      eventManager,
      extraArgs?.agentOptions ?? {},
    );

    this.generalSettings = extraArgs?.generalSettings;
    context.taskFiles = indexFileAttachments(extraArgs?.attachments);
    this.tasks.push(task);
    this.reportStyle = reportStyleFor(task);
    this.navigatorPrompt = new NavigatorPrompt(
      context.options.maxActionsPerStep,
      this.reportStyle,
      context.browserContext.getEngineName(),
    );
    this.plannerPrompt = new PlannerPrompt(this.reportStyle);

    const actionBuilder = new ActionBuilder(context);
    const defaultActions = actionBuilder.buildDefaultActions();
    this.allActionNames = defaultActions.map(action => action.name());
    const navigatorActionRegistry = new NavigatorActionRegistry(defaultActions);

    // Initialize agents with their respective prompts
    this.navigator = new NavigatorAgent(navigatorActionRegistry, {
      chatLLM: navigatorLLM,
      context: context,
      prompt: this.navigatorPrompt,
      provider: extraArgs?.navigatorProvider,
      requestsPerMinute: extraArgs?.navigatorRequestsPerMinute,
      rateLimitKey: extraArgs?.navigatorRateLimitKey,
    });

    this.planner = new PlannerAgent({
      chatLLM: plannerLLM,
      context: context,
      prompt: this.plannerPrompt,
      provider: extraArgs?.plannerProvider ?? extraArgs?.navigatorProvider,
      requestsPerMinute: extraArgs?.plannerRequestsPerMinute ?? extraArgs?.navigatorRequestsPerMinute,
      rateLimitKey: extraArgs?.plannerRateLimitKey ?? extraArgs?.navigatorRateLimitKey,
    });

    this.context = context;
    // Initialize message history
    this.context.messageManager.initTaskMessages(
      this.navigatorPrompt.getSystemMessage(),
      task,
      undefined,
      buildImageContentParts(extraArgs?.attachments),
    );
  }

  subscribeExecutionEvents(callback: EventCallback): void {
    this.context.eventManager.subscribe(EventType.EXECUTION, callback);
  }

  clearExecutionEvents(): void {
    // Clear all execution event listeners
    this.context.eventManager.clearSubscribers(EventType.EXECUTION);
  }

  /** What this run did, used to build the memory a follow-up task starts from. */
  getRunMemory(): { finalAnswer: string | null; actions: TaskMemoryAction[] } {
    return { finalAnswer: this.context.finalAnswer, actions: this.context.runActions };
  }

  addFollowUpTask(task: string): void {
    this.tasks.push(task);
    this.trimFollowUpTaskChain();
    this.context.messageManager.addNewTask(task);
    if (this.reportStyle === 'concise' && reportStyleFor(task) === 'qa') {
      this.context.messageManager.addMessageWithTokens(userMessage(QA_FOLLOW_UP_NOTE), null);
    }

    // need to reset previous action results that are not included in memory
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);
  }

  private trimFollowUpTaskChain(): void {
    if (this.tasks.length <= MAX_TASK_CHAIN_LENGTH) {
      return;
    }

    const overflow = this.tasks.length - MAX_TASK_CHAIN_LENGTH;
    this.tasks.splice(1, overflow);
    logger.warning(
      `Follow-up task chain trimmed by ${overflow} item(s) to keep maximum length at ${MAX_TASK_CHAIN_LENGTH}`,
    );
  }

  /**
   * Check if task is complete based on planner output and handle completion
   */
  private checkTaskCompletion(planOutput: AgentOutput<PlannerOutput> | null): boolean {
    if (planOutput?.result?.done) {
      logger.info('✅ Planner confirms task completion');
      if (planOutput.result.final_answer) {
        this.context.finalAnswer = planOutput.result.final_answer;
      }
      return true;
    }
    return false;
  }

  /**
   * Execute the task
   *
   * @returns {Promise<void>}
   */
  async execute(): Promise<void> {
    const currentTask = this.tasks[this.tasks.length - 1];
    logger.info(`🚀 Executing task: ${currentTask}`);
    // reset the step counter
    const context = this.context;
    context.nSteps = 0;
    // Single-goal requests run without planner calls: the navigator starts directly and its done is final
    this.plannerDisabledForTask = isSimpleTask(currentTask);
    this.loopDetectionState = createLoopDetectionState();
    this.routedHost = null;
    this.jevRuntime = await this.loadJevRuntime(currentTask);
    this.context.jevRuntime = this.jevRuntime;
    if (this.toolsRestricted) {
      this.navigator.restrictActions(null);
      this.toolsRestricted = false;
    }
    const allowedMaxSteps = this.context.options.maxSteps;

    try {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);
      await this.applyJevPreflight(currentTask);

      // Track task start
      void analytics.trackTaskStart(this.context.taskId);

      let step = 0;
      let latestPlanOutput: AgentOutput<PlannerOutput> | null = null;
      let navigatorDone = false;

      for (step = 0; step < allowedMaxSteps; step++) {
        context.stepInfo = {
          stepNumber: context.nSteps,
          maxSteps: context.options.maxSteps,
        };

        logger.info(`🔄 Step ${step + 1} / ${allowedMaxSteps}`);
        if (await this.shouldStop()) {
          break;
        }

        await this.routeToolsForHost(currentTask);

        // Run planner periodically for guidance
        if (
          this.planner &&
          !this.plannerDisabledForTask &&
          (context.nSteps % context.options.planningInterval === 0 || navigatorDone)
        ) {
          const validatingDone = navigatorDone;
          navigatorDone = false;
          latestPlanOutput = await this.runPlanner();

          // Check if task is complete after planner run
          if (this.checkTaskCompletion(latestPlanOutput)) {
            break;
          }
          // A planner that cannot answer (e.g. a model without tool calling) must not keep a finished task
          // running until maxSteps: the navigator's done stands.
          if (validatingDone && !latestPlanOutput?.result) {
            navigatorDone = true;
            break;
          }
        }

        // Execute navigator
        navigatorDone = await this.navigate();

        // If navigator indicates completion, the next periodic planner run will validate it
        if (navigatorDone) {
          logger.info('🔄 Navigator indicates completion - will be validated by next planner run');
          // ponytail: without a planner there is no validation cycle, so the navigator's done is final
          if (this.plannerDisabledForTask) break;
        }

        // A clean step that Jev confirms as complete finishes the task, so the next navigator call is skipped
        if (!navigatorDone && this.isCleanStep() && (await this.checkDoneWithJev(currentTask))) {
          navigatorDone = true;
          break;
        }
      }

      // Determine task completion status:
      // - planner-confirmed completion OR
      // - navigator completed on the last loop iteration (may not get another planner validation cycle)
      const isCompleted = latestPlanOutput?.result?.done === true || navigatorDone;

      if (isCompleted) {
        // Emit final answer if available, otherwise use task ID
        const finalMessage = this.context.finalAnswer || this.context.taskId;
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, finalMessage);

        // Track task completion
        void analytics.trackTaskComplete(this.context.taskId);
      } else if (step >= allowedMaxSteps) {
        logger.error('❌ Task failed: Max steps reached');
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_errors_maxStepsReached'));

        // Track task failure with specific error category
        const maxStepsError = new MaxStepsReachedError(t('exec_errors_maxStepsReached'));
        const errorCategory = analytics.categorizeError(maxStepsError);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      } else if (this.context.stopped) {
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, t('exec_task_pause'));
        // Note: We don't track pause as it's not a final state
      }
    } catch (error) {
      if (error instanceof RequestCancelledError) {
        if (this.context.stopped) {
          await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));

          // Track task cancellation
          void analytics.trackTaskCancelled(this.context.taskId);
        } else {
          // Cancellation can also happen from transport/network interruptions; surface as a failure.
          await this.context.emitEvent(
            Actors.SYSTEM,
            ExecutionState.TASK_FAIL,
            t('exec_task_fail', [describeModelError(error, t)]),
          );
          const errorCategory = analytics.categorizeError(error);
          void analytics.trackTaskFailed(this.context.taskId, errorCategory);
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.context.emitEvent(
          Actors.SYSTEM,
          ExecutionState.TASK_FAIL,
          t('exec_task_fail', [describeModelError(error, t)]),
        );

        // Track task failure with detailed error categorization
        const errorCategory = analytics.categorizeError(error instanceof Error ? error : errorMessage);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      }
    } finally {
      this.logTaskTiming();
      if (import.meta.env.DEV) {
        logger.debug('Executor history', JSON.stringify(this.context.history, null, 2));
      }
      // store the history only if replay is enabled
      if (this.generalSettings?.replayHistoricalTasks) {
        const historyString = JSON.stringify(this.context.history);
        logger.info(`Executor history size: ${historyString.length}`);
        try {
          await chatHistoryStore.storeAgentStepHistory(this.context.taskId, this.tasks[0], historyString);
        } catch (error) {
          // A failed history write must not turn a finished task into a failure
          logger.error(`Failed to store agent step history: ${error}`);
        }
      } else {
        logger.info('Replay historical tasks is disabled, skipping history storage');
      }
    }
  }

  /**
   * Helper method to run planner and store its output
   */
  private async runPlanner(): Promise<AgentOutput<PlannerOutput> | null> {
    const context = this.context;
    try {
      // Add current browser state to memory
      let positionForPlan = 0;
      if (this.tasks.length > 1 || this.context.nSteps > 0) {
        await this.navigator.addStateMessageToMemory();
        positionForPlan = this.context.messageManager.length() - 1;
      } else {
        positionForPlan = this.context.messageManager.length();
      }

      // Execute planner
      this.context.messageManager.cutMessages();
      this.jevRuntime?.metrics.recordLlmCall();
      const planOutput = await this.planner.execute();
      if (planOutput.result) {
        this.context.messageManager.addPlan(JSON.stringify(planOutput.result), positionForPlan);
      }
      return planOutput;
    } catch (error) {
      if (error instanceof RequestCancelledError) {
        if (this.context.stopped) {
          logger.info(`Planner request cancelled: ${error.message}`);
          throw error;
        }
        this.plannerDisabledForTask = true;
        logger.warning(
          `Planner request cancelled: ${error.message}. Planner disabled for this task; continuing with navigator only.`,
        );
        return null;
      }

      if (
        error instanceof ChatModelAuthError ||
        error instanceof ChatModelBadRequestError ||
        error instanceof ChatModelForbiddenError ||
        error instanceof ExtensionConflictError
      ) {
        logger.error(`Failed to execute planner: ${error}`);
        throw error;
      }
      context.consecutiveFailures++;
      logger.error(`Failed to execute planner: ${error}`);
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'));
      }
      return null;
    }
  }

  private async navigate(): Promise<boolean> {
    const context = this.context;
    try {
      // Get and execute navigation action
      // check if the task is paused or stopped
      if (context.paused || context.stopped) {
        logger.debug('navigate skipped because context is paused/stopped', {
          paused: context.paused,
          stopped: context.stopped,
          step: context.nSteps,
        });
        return false;
      }
      const navStartedAt = Date.now();
      logger.debug('navigate start', { step: context.nSteps, taskId: context.taskId });
      const navOutput = await this.navigator.execute();
      logger.debug('navigate end', {
        step: context.nSteps,
        durationMs: Date.now() - navStartedAt,
        hasError: Boolean(navOutput.error),
        done: navOutput.result?.done === true,
      });
      // check if the task is paused or stopped
      if (context.paused || context.stopped) {
        logger.debug('navigate finished but context is paused/stopped', {
          paused: context.paused,
          stopped: context.stopped,
          step: context.nSteps,
        });
        return false;
      }
      context.nSteps++;
      if (navOutput.error) {
        throw new Error(navOutput.error);
      }
      context.consecutiveFailures = 0;
      const done = navOutput.result?.done === true;
      const latestHistoryStep = context.history.history[context.history.history.length - 1];
      const loopDetection = evaluateLoopDetection(this.loopDetectionState, latestHistoryStep, done);
      this.loopDetectionState = loopDetection.nextState;

      if (loopDetection.loopDetected) {
        throw new NavigationLoopDetectedError(t('exec_errors_loopDetected'));
      }

      if (done) {
        return true;
      }
    } catch (error) {
      if (
        error instanceof ChatModelAuthError ||
        error instanceof ChatModelBadRequestError ||
        error instanceof ChatModelForbiddenError ||
        error instanceof RequestCancelledError ||
        error instanceof ExtensionConflictError ||
        error instanceof NavigationLoopDetectedError
      ) {
        if (error instanceof RequestCancelledError) {
          logger.info(`Navigator request cancelled: ${error.message}`);
        } else {
          logger.error(`Failed to execute step: ${error}`);
        }
        throw error;
      }
      context.consecutiveFailures++;
      logger.error(`Failed to execute step: ${error}`);
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'));
      }
    }
    return false;
  }

  private async loadJevRuntime(task: string): Promise<JevRuntime> {
    const config = await jevStore.getConfig().catch(error => {
      logger.error('Could not read Jev settings; Jev features stay off for this task', error);
      return DEFAULT_JEV_CONFIG;
    });
    // Jev receives page content, so an organisation that restricts providers must list it to use it.
    if (!isManagedProviderAllowed({ id: 'jev', type: 'jev' }, getManagedPolicy())) {
      return { config: DEFAULT_JEV_CONFIG, metrics: new JevTaskMetrics(), task };
    }
    return { config, metrics: new JevTaskMetrics(), task };
  }

  /** Decisions made before the first planner call: skipping the planner and hinting at a plugin or workflow. */
  private async applyJevPreflight(task: string): Promise<void> {
    const runtime = this.jevRuntime;
    if (!runtime) return;
    // QA and report tasks keep the planner: its validation writes the structured report
    if (!this.plannerDisabledForTask && this.reportStyle === 'concise' && isJevFeatureOn(runtime, 'plannerSkip')) {
      const singleStep = await decideWithJev(
        runtime,
        'plannerSkip',
        buildPlannerSkipRequest(task),
        decidePlannerSkip,
        this.context.controller.signal,
      );
      if (singleStep) this.plannerDisabledForTask = true;
    }
    if (isJevFeatureOn(runtime, 'pluginRouting')) {
      await this.addPluginRoutingHint(runtime, task);
    }
  }

  private async addPluginRoutingHint(runtime: JevRuntime, task: string): Promise<void> {
    try {
      const url = (await this.context.browserContext.getCachedState()).url;
      const [plugins, workflows] = await Promise.all([browserPluginsStore.getAll(), workflowsStore.getAll()]);
      const candidates = buildRoutingCandidates(plugins, workflows, url);
      if (candidates.length === 0) return;
      const hit = await decideWithJev(
        runtime,
        'pluginRouting',
        buildPluginRoutingRequest(task, url, candidates),
        (answers, threshold) => decidePluginRouting(answers, candidates, threshold),
        this.context.controller.signal,
      );
      if (hit) this.context.messageManager.addMessageWithTokens(userMessage(pluginHintText(hit)), null);
    } catch (error) {
      logger.error('Plugin routing skipped; the navigator sees the full plugin list', error);
    }
  }

  /** Narrows the offered actions once per task, and again when the host changes. */
  private async routeToolsForHost(task: string): Promise<void> {
    const runtime = this.jevRuntime;
    if (!runtime || !isJevFeatureOn(runtime, 'toolRouting')) return;
    const host = hostOf((await this.context.browserContext.getCachedState()).url);
    // A blank page has no host yet; routing waits for the first real page
    if (!host || host === this.routedHost) return;
    this.routedHost = host;
    const groups = await decideWithJev(
      runtime,
      'toolRouting',
      buildToolRoutingRequest(task, host),
      selectActionGroups,
      this.context.controller.signal,
    );
    if (groups) {
      this.navigator.restrictActions(actionNamesForGroups(this.allActionNames, groups));
      this.toolsRestricted = true;
    }
  }

  private isCleanStep(): boolean {
    const { consecutiveFailures, paused, stopped } = this.context;
    return consecutiveFailures === 0 && !paused && !stopped;
  }

  /** Jev done-check: when confident, the task finishes with the last results as its final answer, like a done action. */
  private async checkDoneWithJev(task: string): Promise<boolean> {
    const runtime = this.jevRuntime;
    // QA and report tasks need the LLM's structured report; a Jev "done" would replace it with a short summary.
    if (!runtime || this.reportStyle !== 'concise' || !isJevFeatureOn(runtime, 'doneCheck')) return false;
    const state = await this.context.browserContext.getCachedState();
    const recentResults = this.context.runActions
      .slice(-DONE_CHECK_RESULTS)
      .flatMap(action => (action.content?.trim() ? [action.content] : []));
    const pageText = state.elementTree
      .clickableElementsToString(this.context.options.includeAttributes)
      .slice(0, DONE_CHECK_PAGE_CHARS);
    const complete = await decideWithJev(
      runtime,
      'doneCheck',
      buildDoneCheckRequest({ task, url: state.url, title: state.title, pageText, recentResults }),
      decideDoneCheck,
      this.context.controller.signal,
    );
    if (!complete) return false;
    this.context.finalAnswer = buildDoneCheckFinalAnswer(t('exec_jev_doneCheck_note'), recentResults);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, this.context.finalAnswer);
    return true;
  }

  /** Timing and call counts for the task, logged only in chat debug mode. */
  private logTaskTiming(): void {
    if (!this.generalSettings?.chatDebugMode || !this.jevRuntime) return;
    logger.info('Task timing', JSON.stringify({ taskId: this.context.taskId, ...this.jevRuntime.metrics.summary() }));
  }

  private async shouldStop(): Promise<boolean> {
    if (this.context.stopped) {
      logger.info('Agent stopped');
      return true;
    }

    while (this.context.paused) {
      await new Promise(resolve => setTimeout(resolve, PAUSE_POLL_INTERVAL_MS));
      if (this.context.stopped) {
        return true;
      }
    }

    if (this.context.consecutiveFailures >= this.context.options.maxFailures) {
      logger.error(`Stopping due to ${this.context.options.maxFailures} consecutive failures`);
      throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'));
    }

    return false;
  }

  async cancel(): Promise<void> {
    this.context.stop();
  }

  async resume(): Promise<void> {
    this.context.resume();
    await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_RESUME, t('exec_task_resume'));
  }

  /** Hands the user's answer to a waiting ask_user action. */
  answerQuestion(answer: string): void {
    this.context.answerUserQuestion(answer);
  }

  async pause(): Promise<void> {
    this.context.pause();
    await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, t('exec_task_pause'));
  }

  async cleanup(): Promise<void> {
    try {
      await this.context.browserContext.cleanup();
    } catch (error) {
      logger.error(`Failed to cleanup browser context: ${error}`);
    }
  }

  async getCurrentTaskId(): Promise<string> {
    return this.context.taskId;
  }

  /**
   * Replays a saved history of actions with error handling and retry logic.
   *
   * @param history - The history to replay
   * @param maxRetries - Maximum number of retries per action
   * @param skipFailures - Whether to skip failed actions or stop execution
   * @param delayBetweenActions - Delay between actions in seconds
   * @returns List of action results
   */
  async replayHistory(
    sessionId: string,
    maxRetries = 3,
    skipFailures = true,
    delayBetweenActions = 2.0,
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const replayLogger = createLogger('Executor:replayHistory');

    logger.info('replay task', this.tasks[0]);

    try {
      const historyFromStorage = await chatHistoryStore.loadAgentStepHistory(sessionId);
      if (!historyFromStorage) {
        throw new Error(t('exec_replay_historyNotFound'));
      }

      const history = JSON.parse(historyFromStorage.history) as AgentStepHistory;
      if (history.history.length === 0) {
        throw new Error(t('exec_replay_historyEmpty'));
      }
      logger.debug(`🔄 Replaying history: ${JSON.stringify(history, null, 2)}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);

      for (let i = 0; i < history.history.length; i++) {
        const historyItem = history.history[i];

        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history step with enhanced method that handles all the logic
        // Hold the replay while paused; stop() still breaks out of the wait
        while (this.context.paused && !this.context.stopped) {
          await new Promise(resolve => setTimeout(resolve, PAUSE_POLL_INTERVAL_MS));
        }

        const stepResults = await this.navigator.executeHistoryStep(
          historyItem,
          i,
          history.history.length,
          maxRetries,
          delayBetweenActions * 1000,
          skipFailures,
        );

        results.push(...stepResults);

        // If stopped during execution, break the loop
        if (this.context.stopped) {
          break;
        }
      }

      if (this.context.stopped) {
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_replay_cancel'));
      } else {
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, t('exec_replay_ok'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      replayLogger.error(`Replay failed: ${errorMessage}`);
      await this.context.emitEvent(
        Actors.SYSTEM,
        ExecutionState.TASK_FAIL,
        t('exec_replay_fail', [describeModelError(error, t)]),
      );
    }

    return results;
  }
}
