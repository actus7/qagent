import { z } from 'zod';
import type { BrowserContextLike } from '../browser/types';
import { DEFAULT_INCLUDE_ATTRIBUTES } from '../browser/dom/views';
import type { DOMHistoryElement } from '../browser/dom/history/view';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type EventData, type ExecutionState, AgentEvent } from './event/types';
import { AgentStepHistory } from './history';
import type { TaskMemoryAction } from './task-memory';

export interface AgentOptions {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  includeAttributes: string[];
  planningInterval: number;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 100,
  maxActionsPerStep: 10,
  maxFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: false,
  useVisionForPlanner: true,
  includeAttributes: DEFAULT_INCLUDE_ATTRIBUTES,
  planningInterval: 3,
};

export class AgentContext {
  controller: AbortController;
  taskId: string;
  browserContext: BrowserContextLike;
  messageManager: MessageManager;
  eventManager: EventManager;
  options: AgentOptions;
  paused: boolean;
  stopped: boolean;
  consecutiveFailures: number;
  nSteps: number;
  stepInfo: AgentStepInfo | null;
  actionResults: ActionResult[];
  /** Outcome of every action in this run (the step's actionResults are replaced each step); feeds the task memory. */
  runActions: TaskMemoryAction[];
  stateMessageAdded: boolean;
  history: AgentStepHistory;
  finalAnswer: string | null;
  /** Binary files the user attached to this task, keyed by file name; read by upload_file. */
  taskFiles: Map<string, { mimeType: string; base64: string }>;
  /** Set on resume so the next navigator step refreshes the browser state instead of reusing the cached one. */
  pageStale: boolean;
  /** Checklist kept with todo_write; echoed in every navigator step. */
  todos: TodoItem[];
  /** Tool names per enabled MCP server id, fetched once per task; null when the server could not be reached. */
  mcpToolNames: Map<string, string[] | null>;
  /** Resolves the ask_user action that waits for the user's answer. */
  private answerResolver: ((answer: string) => void) | null;

  constructor(
    taskId: string,
    browserContext: BrowserContextLike,
    messageManager: MessageManager,
    eventManager: EventManager,
    options: Partial<AgentOptions>,
  ) {
    this.controller = new AbortController();
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.options = { ...DEFAULT_AGENT_OPTIONS, ...options };

    this.paused = false;
    this.stopped = false;
    this.nSteps = 0;
    this.consecutiveFailures = 0;
    this.stepInfo = null;
    this.actionResults = [];
    this.runActions = [];
    this.stateMessageAdded = false;
    this.history = new AgentStepHistory();
    this.finalAnswer = null;
    this.taskFiles = new Map();
    this.pageStale = false;
    this.todos = [];
    this.mcpToolNames = new Map();
    this.answerResolver = null;
  }

  async emitEvent(
    actor: Actors,
    state: ExecutionState,
    eventDetails: string,
    takeover?: EventData['takeover'],
    question?: EventData['question'],
  ) {
    const event = new AgentEvent(actor, state, {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
      takeover,
      question,
    });
    await this.eventManager.emit(event);
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
    // The page may have changed while the user had control; the next step must re-read it.
    this.pageStale = true;
  }

  /** Waits for answerUserQuestion; a stop resolves it with an empty answer so the task can end. */
  waitForUserAnswer(): Promise<string> {
    return new Promise(resolve => {
      this.answerResolver = resolve;
    });
  }

  /** Returns false when no question is waiting. */
  answerUserQuestion(answer: string): boolean {
    const resolve = this.answerResolver;
    this.answerResolver = null;
    resolve?.(answer);
    return resolve !== null;
  }

  async stop() {
    this.stopped = true;
    this.answerUserQuestion('');
    setTimeout(() => this.controller.abort(), 300);
  }
}

export interface TodoItem {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;

  constructor(params: { stepNumber: number; maxSteps: number }) {
    this.stepNumber = params.stepNumber;
    this.maxSteps = params.maxSteps;
  }
}

export class ActionResult {
  isDone: boolean;
  success: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: DOMHistoryElement | null;

  constructor(params: Partial<ActionResult> = {}) {
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export class StepMetadata {
  stepStartTime: number;
  stepEndTime: number;
  inputTokens: number;
  stepNumber: number;

  constructor(stepStartTime: number, stepEndTime: number, inputTokens: number, stepNumber: number) {
    this.stepStartTime = stepStartTime;
    this.stepEndTime = stepEndTime;
    this.inputTokens = inputTokens;
    this.stepNumber = stepNumber;
  }

  /**
   * Calculate step duration in seconds
   */
  get durationSeconds(): number {
    return this.stepEndTime - this.stepStartTime;
  }
}

export const agentBrainSchema = z
  .object({
    evaluation_previous_goal: z.string(),
    memory: z.string(),
    next_goal: z.string(),
  })
  .describe('Current state of the agent');

export type AgentBrain = z.infer<typeof agentBrainSchema>;

// Make AgentOutput generic with Zod schema
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}
