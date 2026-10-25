import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../executor';
import { Actors, ExecutionState } from '../event/types';
import { analytics } from '../../services/analytics';

function createExecutor(task: string) {
  const emitEvent = vi.fn().mockResolvedValue(undefined);
  const addMessageWithTokens = vi.fn();
  const context = {
    nSteps: 0,
    options: { maxSteps: 3, planningInterval: 3 },
    taskId: 'task-simple',
    finalAnswer: null,
    stopped: false,
    paused: false,
    stepInfo: null,
    emitEvent,
    messageManager: { addNewTask: vi.fn(), addMessageWithTokens },
    actionResults: [],
  };
  const executor = Object.create(Executor.prototype) as Executor;
  const internals = executor as unknown as Record<string, unknown>;
  internals.context = context;
  internals.tasks = [task];
  internals.reportStyle = task.includes('teste') ? 'qa' : 'concise';
  internals.planner = {};
  internals.generalSettings = undefined;
  internals.loopDetectionState = {};
  internals.shouldStop = vi.fn().mockResolvedValue(false);
  internals.runPlanner = vi.fn().mockResolvedValue({ id: 'planner', result: { done: false } });
  internals.navigate = vi.fn().mockResolvedValue(true);
  return { executor, internals, emitEvent, addMessageWithTokens };
}

describe('Executor planner skipping for simple tasks', () => {
  beforeEach(() => {
    vi.spyOn(analytics, 'trackTaskStart').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskComplete').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskFailed').mockResolvedValue(undefined);
    vi.spyOn(analytics, 'trackTaskCancelled').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the navigator directly and accepts its done without a planner call', async () => {
    const { executor, internals, emitEvent } = createExecutor('Abra a página de preços');

    await executor.execute();

    expect(internals.runPlanner).not.toHaveBeenCalled();
    expect(internals.navigate).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(Actors.SYSTEM, ExecutionState.TASK_OK, 'task-simple');
  });

  it('keeps planner calls for multi-goal tasks', async () => {
    const { executor, internals } = createExecutor('Abra a página de preços e me diga o preço do plano Pro');

    await executor.execute();

    expect(internals.runPlanner).toHaveBeenCalled();
    expect((internals as { plannerDisabledForTask: boolean }).plannerDisabledForTask).toBe(false);
  });

  it('adds a QA note to a QA follow-up when the session uses the concise style', () => {
    const { executor, internals, addMessageWithTokens } = createExecutor('Abra a página de preços');
    internals.tasks = ['Abra a página de preços'];
    const messageManager = (internals.context as { messageManager: { addNewTask: ReturnType<typeof vi.fn> } })
      .messageManager;

    executor.addFollowUpTask('Teste o checkout');
    expect(messageManager.addNewTask).toHaveBeenCalledWith('Teste o checkout');
    expect(addMessageWithTokens).toHaveBeenCalledTimes(1);

    executor.addFollowUpTask('Abra o carrinho');
    expect(addMessageWithTokens).toHaveBeenCalledTimes(1);
  });
});
