import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../executor';
import { Actors, ExecutionState } from '../event/types';
import { analytics } from '../../services/analytics';

function createExecutorHarness() {
  const emitEvent = vi.fn().mockResolvedValue(undefined);
  const context = {
    nSteps: 0,
    options: {
      maxSteps: 1,
      planningInterval: 3,
    },
    taskId: 'task-123',
    finalAnswer: null,
    stopped: false,
    stepInfo: null,
    emitEvent,
  };

  const executor = Object.create(Executor.prototype) as Executor;
  (executor as unknown as Record<string, unknown>).context = context;
  (executor as unknown as Record<string, unknown>).tasks = ['do something'];
  (executor as unknown as Record<string, unknown>).planner = {};
  (executor as unknown as Record<string, unknown>).generalSettings = undefined;
  (executor as unknown as Record<string, unknown>).loopDetectionState = {};
  (executor as unknown as Record<string, unknown>).shouldStop = vi.fn().mockResolvedValue(false);
  (executor as unknown as Record<string, unknown>).runPlanner = vi
    .fn()
    .mockResolvedValue({ id: 'planner', result: { done: false } });
  (executor as unknown as Record<string, unknown>).navigate = vi.fn().mockResolvedValue(true);

  return { executor, emitEvent };
}

describe('Executor completion state', () => {
  beforeEach(() => {
    vi.spyOn(analytics, 'trackTaskStart').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskComplete').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskFailed').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskCancelled').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fail when navigator completes on the final allowed step', async () => {
    const { executor, emitEvent } = createExecutorHarness();

    await executor.execute();

    const emittedStates = emitEvent.mock.calls.map(([, state]) => state);
    expect(emittedStates).toContain(ExecutionState.TASK_OK);
    expect(emittedStates).not.toContain(ExecutionState.TASK_FAIL);
    expect(emitEvent).toHaveBeenCalledWith(Actors.SYSTEM, ExecutionState.TASK_OK, 'task-123');
  });

  it('limits follow-up task chain length and keeps the initial task', () => {
    const addNewTask = vi.fn();
    const executor = Object.create(Executor.prototype) as Executor;
    const context = {
      messageManager: { addNewTask },
      actionResults: [{ includeInMemory: false }, { includeInMemory: true }],
    };
    const tasks = ['initial-task', ...Array.from({ length: 49 }, (_, index) => `follow-up-${index + 1}`)];

    (executor as unknown as Record<string, unknown>).context = context;
    (executor as unknown as Record<string, unknown>).tasks = tasks;

    executor.addFollowUpTask('follow-up-50');

    const updatedTasks = (executor as unknown as { tasks: string[] }).tasks;
    expect(updatedTasks).toHaveLength(50);
    expect(updatedTasks[0]).toBe('initial-task');
    expect(updatedTasks[updatedTasks.length - 1]).toBe('follow-up-50');
    expect(addNewTask).toHaveBeenCalledWith('follow-up-50');
    expect(context.actionResults).toEqual([{ includeInMemory: true }]);
  });
});
