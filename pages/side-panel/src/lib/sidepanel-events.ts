import { Actors, type Message } from '@extension/storage';
import { AgentEvent, EventType, ExecutionState } from '@src/types/event';
import type { ExecutionPortEventMessage } from '@src/types/port';

export const formatDebugEvent = (event: AgentEvent) => {
  const stepNumber = typeof event.data?.step === 'number' ? event.data.step + 1 : null;
  const payload = {
    type: event.type,
    actor: event.actor,
    state: event.state,
    timestamp: event.timestamp,
    data: event.data,
  };

  return [
    `[DEBUG] ${event.actor}.${event.state} | step ${stepNumber ?? '-'} / ${event.data?.maxSteps ?? '-'}`,
    JSON.stringify(payload, null, 2),
  ].join('\n');
};

const isValidActor = (value: string): value is Actors => {
  return Object.values(Actors).includes(value as Actors);
};

const isValidExecutionState = (value: string): value is ExecutionState => {
  return Object.values(ExecutionState).includes(value as ExecutionState);
};

export const toAgentEvent = (message: ExecutionPortEventMessage): AgentEvent | null => {
  if (!isValidActor(message.actor) || !isValidExecutionState(message.state)) {
    return null;
  }

  return new AgentEvent(message.actor, message.state, message.data, message.timestamp, EventType.EXECUTION);
};

export type TaskDisplayResult =
  | { ok: true; skip: boolean; displayProgress: boolean }
  | { ok: false; error: string; detail: string };

const display = (skip: boolean, displayProgress = false): TaskDisplayResult => ({ ok: true, skip, displayProgress });
const invalid = (error: string, detail: string): TaskDisplayResult => ({ ok: false, error, detail });

const planSystem = (state: ExecutionState): TaskDisplayResult => {
  switch (state) {
    case ExecutionState.TASK_START:
    case ExecutionState.TASK_OK:
    case ExecutionState.TASK_PAUSE:
    case ExecutionState.TASK_RESUME:
      return display(true);
    case ExecutionState.TASK_FAIL:
    case ExecutionState.TASK_CANCEL:
      return display(false);
    default:
      return invalid('Invalid task state', state);
  }
};

const planPlanner = (state: ExecutionState): TaskDisplayResult => {
  switch (state) {
    case ExecutionState.STEP_START:
      return display(true, true);
    case ExecutionState.STEP_OK:
    case ExecutionState.STEP_CANCEL:
      return display(true);
    case ExecutionState.STEP_FAIL:
      return display(false);
    default:
      return invalid('Invalid step state', state);
  }
};

const planNavigator = (state: ExecutionState, content: string | undefined): TaskDisplayResult => {
  switch (state) {
    case ExecutionState.STEP_START:
      return display(true, true);
    case ExecutionState.STEP_OK:
    case ExecutionState.STEP_CANCEL:
    case ExecutionState.ACT_START:
      return display(true);
    case ExecutionState.STEP_FAIL:
    case ExecutionState.ACT_FAIL:
      return display(false);
    case ExecutionState.ACT_OK:
      return display(content === 'cache_content');
    default:
      return invalid('Invalid action', state);
  }
};

const planValidator = (state: ExecutionState): TaskDisplayResult => {
  switch (state) {
    case ExecutionState.STEP_START:
      return display(true, true);
    case ExecutionState.STEP_OK:
    case ExecutionState.STEP_FAIL:
      return display(false);
    default:
      return invalid('Invalid validation', state);
  }
};

/**
 * Decides how an execution event is shown in the chat: whether the message is skipped,
 * and whether a progress placeholder is displayed. Invalid combinations are reported, not thrown.
 */
export const planTaskDisplay = (
  actor: Actors,
  state: ExecutionState,
  content: string | undefined,
): TaskDisplayResult => {
  switch (actor) {
    case Actors.SYSTEM:
      return planSystem(state);
    case Actors.USER:
      return display(true);
    case Actors.PLANNER:
      return planPlanner(state);
    case Actors.NAVIGATOR:
      return planNavigator(state, content);
    case Actors.VALIDATOR:
      return planValidator(state);
    default:
      return invalid('Unknown actor', String(actor));
  }
};

export type AppendMessage = (message: Message, sessionId?: string | null) => unknown;
