import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '../../__tests__/utils/chromeStorageMock';
import {
  RUNNING_TASK_KEY,
  clearRunningTask,
  readRunningTask,
  recoverInterruptedTask,
  saveRunningTask,
  startServiceWorkerKeepAlive,
  updateRunningTaskSteps,
  type RunningTaskRecord,
} from '../runState';

const runningRecord: RunningTaskRecord = {
  taskId: 'session-1',
  task: 'Click the Go button',
  mode: 'act',
  tabIds: [7],
  stepCount: 2,
  status: 'running',
  startedAt: 1000,
};

describe('running task state', () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  it('persists the running record in chrome.storage.session and reads it back', async () => {
    await saveRunningTask(runningRecord);

    expect(await readRunningTask()).toEqual(runningRecord);
  });

  it('returns null for a stored value that is not a running record', async () => {
    await chrome.storage.session.set({ [RUNNING_TASK_KEY]: { taskId: 42 } });

    expect(await readRunningTask()).toBeNull();
  });

  it('only moves the step count forward while the task is running', async () => {
    await saveRunningTask(runningRecord);

    await updateRunningTaskSteps(1);
    expect((await readRunningTask())?.stepCount).toBe(2);

    await updateRunningTaskSteps(5);
    expect((await readRunningTask())?.stepCount).toBe(5);
  });

  it('clears the record when the task ends', async () => {
    await saveRunningTask(runningRecord);

    await clearRunningTask();

    expect(await readRunningTask()).toBeNull();
  });
});

describe('recoverInterruptedTask', () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  it('marks a task left running by a dead worker as interrupted and keeps its memory and a chat notice', async () => {
    // Arrange
    await saveRunningTask(runningRecord);
    const saveMemory = vi.fn(async () => {});
    const addNotice = vi.fn(async () => {});

    // Act
    const recovered = await recoverInterruptedTask({ saveMemory, addNotice });

    // Assert
    expect(recovered?.status).toBe('interrupted');
    expect((await readRunningTask())?.status).toBe('interrupted');
    expect(saveMemory).toHaveBeenCalledWith('session-1', expect.stringContaining('Outcome: interrupted'));
    expect(saveMemory).toHaveBeenCalledWith('session-1', expect.stringContaining('Previous task: Click the Go button'));
    expect(addNotice).toHaveBeenCalledWith('session-1', expect.any(String));
  });

  it('does nothing when no task was running', async () => {
    const saveMemory = vi.fn(async () => {});
    const addNotice = vi.fn(async () => {});

    expect(await recoverInterruptedTask({ saveMemory, addNotice })).toBeNull();
    expect(saveMemory).not.toHaveBeenCalled();
    expect(addNotice).not.toHaveBeenCalled();
  });

  it('does not recover the same task twice', async () => {
    await saveRunningTask({ ...runningRecord, status: 'interrupted' });
    const addNotice = vi.fn(async () => {});

    expect(await recoverInterruptedTask({ saveMemory: vi.fn(async () => {}), addNotice })).toBeNull();
    expect(addNotice).not.toHaveBeenCalled();
  });
});

describe('startServiceWorkerKeepAlive', () => {
  const getPlatformInfo = vi.fn(async () => ({ os: 'win' }));

  beforeEach(() => {
    vi.useFakeTimers();
    getPlatformInfo.mockClear();
    vi.stubGlobal('chrome', { runtime: { getPlatformInfo } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pings an extension API on an interval until stopped', () => {
    const stop = startServiceWorkerKeepAlive();

    vi.advanceTimersByTime(60_000);
    const pings = getPlatformInfo.mock.calls.length;
    expect(pings).toBeGreaterThanOrEqual(2);

    stop();
    vi.advanceTimersByTime(60_000);
    expect(getPlatformInfo.mock.calls.length).toBe(pings);
  });
});
