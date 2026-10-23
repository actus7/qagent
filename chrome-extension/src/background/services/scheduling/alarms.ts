import { scheduledTasksStore } from '@extension/storage';
import type { ScheduledTask } from '@extension/storage';

export const SCHEDULE_ALARM_PREFIX = 'qagent-schedule:';
// Alarms closer than this are pushed out so a schedule due right now does not fire during its own save.
const MIN_ALARM_DELAY_MS = 1_000;

export function scheduleAlarmName(id: string): string {
  return `${SCHEDULE_ALARM_PREFIX}${id}`;
}

export function scheduleIdFromAlarm(name: string): string | null {
  return name.startsWith(SCHEDULE_ALARM_PREFIX) ? name.slice(SCHEDULE_ALARM_PREFIX.length) : null;
}

/** Alarm times for the enabled schedules that have a next run. Pure, so the mapping is testable without Chrome. */
export function alarmPlan(tasks: ScheduledTask[], now: number): Map<string, number> {
  const plan = new Map<string, number>();
  for (const task of tasks) {
    if (!task.enabled || task.nextRunAt === null) continue;
    plan.set(scheduleAlarmName(task.id), Math.max(task.nextRunAt, now + MIN_ALARM_DELAY_MS));
  }
  return plan;
}

/** Makes the schedule alarms match storage: one per enabled schedule, and no leftovers from deleted ones. */
export async function syncScheduleAlarms(
  tasks?: ScheduledTask[],
  now: number = Date.now(),
): Promise<void> {
  const plan = alarmPlan(tasks ?? (await scheduledTasksStore.getTasks()), now);
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing
      .filter(alarm => alarm.name.startsWith(SCHEDULE_ALARM_PREFIX) && !plan.has(alarm.name))
      .map(alarm => chrome.alarms.clear(alarm.name)),
  );
  await Promise.all(
    [...plan].map(([name, when]) => chrome.alarms.create(name, { when })),
  );
}
