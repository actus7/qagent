import { createLogger } from '../../log';
import { syncScheduleAlarms, scheduleIdFromAlarm } from './alarms';
import { runScheduledTask } from './runner';

const logger = createLogger('background');
// Key used by scheduledTasksStore in chrome.storage.local (see packages/storage/lib/schedule).
const SCHEDULED_TASKS_KEY = 'scheduled-tasks';

/** Registers the alarm listener synchronously (Chrome requires it at top level) and resyncs alarms from storage. */
export function registerScheduleListeners(): void {
  chrome.alarms.onAlarm.addListener(alarm => {
    const id = scheduleIdFromAlarm(alarm.name);
    if (!id) return;
    runScheduledTask(id).catch(error => logger.error(`Scheduled task ${id} crashed:`, error));
  });

  // Covers worker restarts (alarms persist, but the plan may have changed) and every edit from the panel or options.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SCHEDULED_TASKS_KEY]) return;
    syncScheduleAlarms().catch(error => logger.error('Failed to sync schedule alarms:', error));
  });

  syncScheduleAlarms().catch(error => logger.error('Failed to sync schedule alarms at startup:', error));
}
