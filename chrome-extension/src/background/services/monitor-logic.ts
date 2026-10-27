// Monitor records and their transitions. Pure: the storage and alarm wiring lives in monitors.ts.

const MONITOR_ALARM_PREFIX = 'qagent-monitor:';
const MONITOR_ID_PATTERN = /^mon-[a-z0-9]{6}$/;
const MAX_CHANGED_CHARS = 1000;

export type MonitorStatus = 'watching' | 'changed' | 'stopped' | 'expired' | 'lost';

export interface MonitorRecord {
  id: string;
  tabId: number;
  selector: string;
  status: MonitorStatus;
  startedAt: number;
  deadline: number;
  /** Normalized text of the element after the change. Empty until the status is 'changed'. */
  changedText: string;
  updatedAt: number;
}

export type MonitorEvent =
  | { type: 'changed'; text: string; at: number }
  | { type: 'stopped'; at: number }
  | { type: 'expired'; at: number }
  | { type: 'lost'; at: number };

export function monitorAlarmName(id: string): string {
  return `${MONITOR_ALARM_PREFIX}${id}`;
}

export function monitorIdFromAlarm(name: string): string | null {
  return name.startsWith(MONITOR_ALARM_PREFIX) ? name.slice(MONITOR_ALARM_PREFIX.length) : null;
}

export function isValidMonitorId(id: string): boolean {
  return MONITOR_ID_PATTERN.test(id);
}

/** A short random id the model can copy back. */
export function newMonitorId(random: () => number = Math.random): string {
  let suffix = '';
  while (suffix.length < 6) suffix += Math.floor(random() * 36).toString(36);
  return `mon-${suffix}`;
}

export function isWatching(record: MonitorRecord): boolean {
  return record.status === 'watching';
}

/** Tabs that host at least one watch. */
export function tabsWithWatches(records: Record<string, MonitorRecord>): Set<number> {
  return new Set(
    Object.values(records)
      .filter(isWatching)
      .map(record => record.tabId),
  );
}

/** Only a watching monitor moves; once it changed, expired, stopped or lost, the outcome is final. */
export function applyMonitorEvent(record: MonitorRecord, event: MonitorEvent): MonitorRecord {
  if (!isWatching(record)) return record;
  if (event.type === 'changed') {
    return { ...record, status: 'changed', changedText: event.text.slice(0, MAX_CHANGED_CHARS), updatedAt: event.at };
  }
  return {
    ...record,
    status: event.type === 'lost' ? 'lost' : event.type === 'stopped' ? 'stopped' : 'expired',
    updatedAt: event.at,
  };
}

/** Deadline for a monitor started at `now`, clamped to the allowed range in minutes. */
export function monitorDeadline(now: number, timeoutMinutes: number): number {
  return now + timeoutMinutes * 60_000;
}
