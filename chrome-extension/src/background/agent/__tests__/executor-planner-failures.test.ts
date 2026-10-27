import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../executor';
import { Actors, ExecutionState } from '../event/types';
import { analytics } from '../../services/analytics';

function createAgentContext(maxFailures: number) {
  const emitEvent = vi.fn().mockResolvedValue(undefined);
  const messageManager = {
    length: vi.fn().mockReturnValue(1),
    cutMessages: vi.fn(),
    addPlan: vi.fn(),
  };

  return {
    nSteps: 0,
    options: {
      maxSteps: 5,
      planningInterval: 1,
      maxFailures,
    },
    taskId: 'task-planner-failures',
    finalAnswer: null,
    stopped: false,
    paused: false,
    stepInfo: null,
    consecutiveFailures: 0,
    history: { history: [] },
    messageManager,
    emitEvent,
  };
}

function createExecutor(context: ReturnType<typeof createAgentContext>, planner: { execute: () => Promise<unknown> }) {
  const executor = Object.create(Executor.prototype) as unknown as Record<string, unknown>;
  Object.assign(executor, {
    context,
    tasks: ['check the signup form'],
    planner,
    navigator: { addStateMessageToMemory: vi.fn().mockResolvedValue(undefined) },
    plannerDisabledForTask: false,
    generalSettings: undefined,
    loopDetectionState: {},
    navigate: vi.fn().mockResolvedValue(false),
  });
  return executor as unknown as Executor;
}

const emittedStates = (context: ReturnType<typeof createAgentContext>) =>
  context.emitEvent.mock.calls.map(([, state]) => state);

describe('Executor planner failures', () => {
  beforeEach(() => {
    vi.spyOn(analytics, 'trackTaskStart').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskComplete').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskFailed').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskCancelled').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts planner errors as consecutive failures and fails the task at maxFailures', async () => {
    const context = createAgentContext(2);
    const planner = { execute: vi.fn().mockResolvedValue({ id: 'planner', error: 'Could not parse response' }) };
    const executor = createExecutor(context, planner);

    await executor.execute();

    expect(planner.execute).toHaveBeenCalledTimes(2);
    const states = emittedStates(context);
    expect(states).toContain(ExecutionState.TASK_FAIL);
    expect(states).not.toContain(ExecutionState.TASK_OK);
  });

  it('keeps the planner enabled after a planner LLM timeout and counts it as a failure', async () => {
    const context = createAgentContext(3);
    const planner = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ id: 'planner', error: 'planner timed out' })
        .mockResolvedValueOnce({ id: 'planner', result: { done: true, final_answer: 'ok' } }),
    };
    const executor = createExecutor(context, planner);

    await executor.execute();

    expect((executor as unknown as { plannerDisabledForTask: boolean }).plannerDisabledForTask).toBe(false);
    expect(planner.execute).toHaveBeenCalledTimes(2);
    expect(context.emitEvent).toHaveBeenCalledWith(Actors.SYSTEM, ExecutionState.TASK_OK, 'ok');
  });

  it('reads the browser state before the first planner call', async () => {
    const context = createAgentContext(3);
    const planner = { execute: vi.fn().mockResolvedValue({ id: 'planner', result: { done: false } }) };
    const executor = createExecutor(context, planner);
    const navigator = (executor as unknown as { navigator: { addStateMessageToMemory: ReturnType<typeof vi.fn> } })
      .navigator;

    await (executor as unknown as { runPlanner: () => Promise<unknown> }).runPlanner();

    expect(navigator.addStateMessageToMemory).toHaveBeenCalledTimes(1);
    expect(navigator.addStateMessageToMemory.mock.invocationCallOrder[0]).toBeLessThan(
      planner.execute.mock.invocationCallOrder[0],
    );
  });

  it('does not treat a planner error as a planner cancellation', async () => {
    const context = createAgentContext(3);
    const planner = { execute: vi.fn().mockResolvedValue({ id: 'planner', error: 'planner timed out' }) };
    const executor = createExecutor(context, planner);

    const output = await (executor as unknown as { runPlanner: () => Promise<unknown> }).runPlanner();

    expect(output).toBeNull();
    expect(context.consecutiveFailures).toBe(1);
    expect((executor as unknown as { plannerDisabledForTask: boolean }).plannerDisabledForTask).toBe(false);
  });
});
