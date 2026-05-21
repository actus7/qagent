import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../executor';
import { RequestCancelledError } from '../agents/errors';
import { Actors, ExecutionState } from '../event/types';
import { analytics } from '../../services/analytics';

function createContext() {
  const emitEvent = vi.fn().mockResolvedValue(undefined);
  const messageManager = {
    length: vi.fn().mockReturnValue(0),
    cutMessages: vi.fn(),
    addPlan: vi.fn(),
  };

  return {
    nSteps: 0,
    options: {
      maxSteps: 1,
      planningInterval: 1,
      maxFailures: 3,
    },
    taskId: 'task-planner-resilience',
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

describe('Executor planner resilience', () => {
  beforeEach(() => {
    vi.spyOn(analytics, 'trackTaskStart').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskComplete').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskFailed').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskCancelled').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables planner and continues when planner request is cancelled by timeout', async () => {
    const context = createContext();
    const executePlanner = vi.fn().mockRejectedValue(new RequestCancelledError('planner timed out'));

    const executor = Object.create(Executor.prototype) as Executor;
    (executor as unknown as Record<string, unknown>).context = context;
    (executor as unknown as Record<string, unknown>).tasks = ['test mobile menu'];
    (executor as unknown as Record<string, unknown>).planner = { execute: executePlanner };
    (executor as unknown as Record<string, unknown>).navigator = { addStateMessageToMemory: vi.fn() };
    (executor as unknown as Record<string, unknown>).plannerDisabledForTask = false;
    (executor as unknown as Record<string, unknown>).generalSettings = undefined;
    (executor as unknown as Record<string, unknown>).loopDetectionState = {};
    (executor as unknown as Record<string, unknown>).shouldStop = vi.fn().mockResolvedValue(false);
    (executor as unknown as Record<string, unknown>).navigate = vi.fn().mockResolvedValue(true);

    await executor.execute();

    const emittedStates = context.emitEvent.mock.calls.map(([, state]) => state);
    expect(emittedStates).toContain(ExecutionState.TASK_OK);
    expect(emittedStates).not.toContain(ExecutionState.TASK_FAIL);
    expect((executor as unknown as { plannerDisabledForTask: boolean }).plannerDisabledForTask).toBe(true);
    expect(context.emitEvent).toHaveBeenCalledWith(Actors.SYSTEM, ExecutionState.TASK_OK, 'task-planner-resilience');
    expect(executePlanner).toHaveBeenCalledTimes(1);
  });

  it('propagates planner cancellation when task is explicitly stopped', async () => {
    const context = createContext();
    context.stopped = true;
    const executePlanner = vi.fn().mockRejectedValue(new RequestCancelledError('user cancelled'));

    const executor = Object.create(Executor.prototype) as Executor;
    (executor as unknown as Record<string, unknown>).context = context;
    (executor as unknown as Record<string, unknown>).tasks = ['test mobile menu'];
    (executor as unknown as Record<string, unknown>).planner = { execute: executePlanner };
    (executor as unknown as Record<string, unknown>).navigator = { addStateMessageToMemory: vi.fn() };
    (executor as unknown as Record<string, unknown>).plannerDisabledForTask = false;
    (executor as unknown as Record<string, unknown>).generalSettings = undefined;
    (executor as unknown as Record<string, unknown>).loopDetectionState = {};
    (executor as unknown as Record<string, unknown>).shouldStop = vi.fn().mockResolvedValue(true);
    (executor as unknown as Record<string, unknown>).navigate = vi.fn().mockResolvedValue(false);

    await executor.execute();

    const emittedStates = context.emitEvent.mock.calls.map(([, state]) => state);
    expect(emittedStates).toContain(ExecutionState.TASK_CANCEL);
    expect(emittedStates).not.toContain(ExecutionState.TASK_FAIL);
    expect((executor as unknown as { plannerDisabledForTask: boolean }).plannerDisabledForTask).toBe(false);
  });
});
