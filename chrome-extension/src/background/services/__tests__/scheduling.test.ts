import { describe, expect, it, vi } from 'vitest';

// The runner pulls in the task pipeline, whose polyfill import refuses to load outside a browser extension.
vi.mock('webextension-polyfill', () => ({}));
import { computeNextRunAt, type ScheduledTask, type ScheduleTiming } from '@extension/storage';
import { decideScheduledRun, BUSY_SKIP_DETAIL } from '../scheduling/decision';
import { alarmPlan, scheduleAlarmName, scheduleIdFromAlarm } from '../scheduling/alarms';
import { outcomeForState, runScheduledTaskWith, type ScheduleRunDeps } from '../scheduling/runner';
import { ExecutionState } from '../../agent/event/types';

// Local-time constructors keep these expectations valid in any timezone.
const local = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

const timing = (overrides: Partial<ScheduleTiming>): ScheduleTiming => ({
  frequency: 'daily',
  time: '09:00',
  date: null,
  weekday: 1,
  dayOfMonth: 1,
  ...overrides,
});

describe('computeNextRunAt', () => {
  it('runs a daily schedule today when the time has not passed, otherwise tomorrow', () => {
    expect(computeNextRunAt(timing({}), local(2026, 3, 10, 8))).toBe(local(2026, 3, 10, 9));
    expect(computeNextRunAt(timing({}), local(2026, 3, 10, 9, 30))).toBe(local(2026, 3, 11, 9));
  });

  it('rolls a daily schedule over month and year boundaries', () => {
    expect(computeNextRunAt(timing({}), local(2026, 12, 31, 23))).toBe(local(2027, 1, 1, 9));
  });

  it('runs a weekly schedule on the next matching weekday', () => {
    // 2026-03-10 is a Tuesday (getDay 2); weekday 4 is Thursday.
    expect(computeNextRunAt(timing({ frequency: 'weekly', weekday: 4 }), local(2026, 3, 10, 8))).toBe(
      local(2026, 3, 12, 9),
    );
  });

  it('runs a weekly schedule a week later when today is the weekday but the time passed', () => {
    expect(computeNextRunAt(timing({ frequency: 'weekly', weekday: 2 }), local(2026, 3, 10, 10))).toBe(
      local(2026, 3, 17, 9),
    );
  });

  it('clamps a monthly day 31 to the end of shorter months, including February of a leap year', () => {
    expect(computeNextRunAt(timing({ frequency: 'monthly', dayOfMonth: 31 }), local(2026, 2, 1))).toBe(
      local(2026, 2, 28),
    );
    expect(computeNextRunAt(timing({ frequency: 'monthly', dayOfMonth: 31 }), local(2028, 2, 1))).toBe(
      local(2028, 2, 29),
    );
  });

  it('moves a monthly schedule past its day to the next month, clamped as well', () => {
    expect(computeNextRunAt(timing({ frequency: 'monthly', dayOfMonth: 31 }), local(2026, 2, 28, 10))).toBe(
      local(2026, 3, 31),
    );
  });

  it('runs a one-time schedule only while its date is still in the future', () => {
    const once = timing({ frequency: 'once', date: '2026-05-01' });

    expect(computeNextRunAt(once, local(2026, 4, 30))).toBe(local(2026, 5, 1));
    expect(computeNextRunAt(once, local(2026, 5, 2))).toBeNull();
  });

  it('rejects impossible dates and malformed times', () => {
    expect(computeNextRunAt(timing({ frequency: 'once', date: '2026-02-31' }), 0)).toBeNull();
    expect(computeNextRunAt(timing({ time: '25:00' }), 0)).toBeNull();
    expect(computeNextRunAt(timing({ frequency: 'weekly', weekday: 7 }), 0)).toBeNull();
  });
});

const task: ScheduledTask = {
  id: 't1',
  name: 'Smoke',
  prompt: 'Verifique o login',
  mode: 'act',
  startUrl: 'https://app.test/login',
  enabled: true,
  nextRunAt: null,
  createdAt: 0,
  history: [],
  ...timing({}),
};

describe('decideScheduledRun', () => {
  const allowAll = () => true;

  it('ignores a schedule that no longer exists', () => {
    expect(decideScheduledRun({ task: undefined, busy: false, isUrlAllowed: allowAll })).toEqual({ action: 'ignore' });
  });

  it('skips the run while another task is in progress', () => {
    expect(decideScheduledRun({ task, busy: true, isUrlAllowed: allowAll })).toEqual({
      action: 'skip',
      detail: BUSY_SKIP_DETAIL,
    });
  });

  it('blocks an act task without a start URL', () => {
    const decision = decideScheduledRun({ task: { ...task, startUrl: null }, busy: false, isUrlAllowed: allowAll });

    expect(decision.action).toBe('block');
  });

  it('blocks a start URL the firewall refuses', () => {
    expect(decideScheduledRun({ task, busy: false, isUrlAllowed: () => false })).toEqual({
      action: 'block',
      detail: 'bloqueada pelo firewall',
    });
  });

  it('runs when the worker is free and the start URL is allowed', () => {
    expect(decideScheduledRun({ task, busy: false, isUrlAllowed: allowAll })).toEqual({ action: 'run' });
  });
});

describe('schedule alarms', () => {
  it('plans one alarm per enabled schedule with a next run, never in the past', () => {
    const now = local(2026, 3, 10, 12);
    const tasks: ScheduledTask[] = [
      { ...task, id: 'a', nextRunAt: local(2026, 3, 11, 9) },
      { ...task, id: 'b', enabled: false, nextRunAt: local(2026, 3, 11, 9) },
      { ...task, id: 'c', nextRunAt: null },
      { ...task, id: 'd', nextRunAt: now - 60_000 },
    ];

    const plan = alarmPlan(tasks, now);

    expect([...plan.keys()]).toEqual([scheduleAlarmName('a'), scheduleAlarmName('d')]);
    expect(plan.get(scheduleAlarmName('a'))).toBe(local(2026, 3, 11, 9));
    expect(plan.get(scheduleAlarmName('d'))).toBe(now + 1_000);
  });

  it('maps alarm names back to schedule ids and ignores unrelated alarms', () => {
    expect(scheduleIdFromAlarm(scheduleAlarmName('xyz'))).toBe('xyz');
    expect(scheduleIdFromAlarm('other-alarm')).toBeNull();
  });
});

describe('outcomeForState', () => {
  it('maps terminal states to run outcomes', () => {
    expect(outcomeForState(ExecutionState.TASK_OK).outcome).toBe('completed');
    expect(outcomeForState(ExecutionState.TASK_FAIL).outcome).toBe('failed');
    expect(outcomeForState(ExecutionState.TASK_PAUSE).outcome).toBe('cancelled');
    expect(outcomeForState(null).outcome).toBe('cancelled');
  });
});

describe('runScheduledTaskWith', () => {
  function fakeDeps(initial: ScheduledTask | undefined, overrides: Partial<ScheduleRunDeps> = {}) {
    let stored = initial;
    const runs: unknown[] = [];
    const started: unknown[] = [];
    const deps: ScheduleRunDeps = {
      getTask: async () => stored,
      saveTask: async next => {
        stored = next;
      },
      appendRun: async (_id, run) => {
        runs.push(run);
      },
      isBusy: () => false,
      isUrlAllowed: async () => true,
      createSession: async () => 'session-1',
      openStartTab: async () => 7,
      startTask: async command => {
        started.push(command);
        return ExecutionState.TASK_OK;
      },
      syncAlarms: async () => {},
      now: () => local(2026, 3, 10, 9, 1),
      ...overrides,
    };
    return { deps, runs, started, current: () => stored };
  }

  it('runs the task in a new session on the start tab and records the completion', async () => {
    const { deps, runs, started, current } = fakeDeps(task);

    await runScheduledTaskWith('t1', deps);

    expect(started).toEqual([
      expect.objectContaining({
        taskId: 'session-1',
        tabId: 7,
        options: { mode: 'act', permissionMode: 'auto', tabIds: [7] },
      }),
    ]);
    expect(runs).toEqual([expect.objectContaining({ outcome: 'completed', sessionId: 'session-1' })]);
    expect(current()?.nextRunAt).toBe(local(2026, 3, 11, 9));
  });

  it('records a skipped run without starting a task when another task is busy', async () => {
    const { deps, runs, started } = fakeDeps(task, { isBusy: () => true });

    await runScheduledTaskWith('t1', deps);

    expect(started).toHaveLength(0);
    expect(runs).toEqual([expect.objectContaining({ outcome: 'skipped', detail: BUSY_SKIP_DETAIL })]);
  });

  it('disables a one-time schedule after its single run', async () => {
    const once = { ...task, frequency: 'once' as const, date: '2026-03-10' };
    const { deps, current } = fakeDeps(once);

    await runScheduledTaskWith('t1', deps);

    expect(current()).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('records a failure when the task cannot start', async () => {
    const { deps, runs } = fakeDeps(task, {
      startTask: async () => {
        throw new Error('boom');
      },
    });

    await runScheduledTaskWith('t1', deps);

    expect(runs).toEqual([expect.objectContaining({ outcome: 'failed', detail: 'boom' })]);
  });
});
