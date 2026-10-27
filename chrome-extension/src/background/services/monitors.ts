import { createLogger } from '../log';
import { notifyTaskAttention } from './task-notifications';
import {
  applyMonitorEvent,
  isValidMonitorId,
  isWatching,
  monitorAlarmName,
  monitorDeadline,
  monitorIdFromAlarm,
  newMonitorId,
  tabsWithWatches,
  type MonitorEvent,
  type MonitorRecord,
} from './monitor-logic';

const logger = createLogger('monitors');
const SESSION_KEY = 'qagent-monitors';
// Content-script messages. The sender tab comes from the runtime, never from the payload.
const MONITOR_START_MESSAGE = 'qagent:monitor:start';
const MONITOR_STOP_MESSAGE = 'qagent:monitor:stop';
const MONITOR_CHANGED_MESSAGE = 'qagent:monitor:changed';
const POLL_MS = 500;

// Writes are queued so two events (a change and an alarm) never overwrite each other's record.
let writeQueue: Promise<unknown> = Promise.resolve();
// In-memory mirror of the tabs with a watch, so the hot tabs.onUpdated listener skips storage on unrelated tabs.
// Kept in sync via storage.onChanged; the initial read yields to any change that arrived first.
let watchedTabs = new Set<number>();
let watchedTabsFromEvents = false;

function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => undefined);
  return run;
}

async function readAll(): Promise<Record<string, MonitorRecord>> {
  return ((await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? {}) as Record<string, MonitorRecord>;
}

export async function getMonitor(id: string): Promise<MonitorRecord | null> {
  return (await readAll())[id] ?? null;
}

export async function listMonitors(): Promise<MonitorRecord[]> {
  return Object.values(await readAll()).sort((a, b) => b.startedAt - a.startedAt);
}

function updateMonitor(id: string, event: MonitorEvent): Promise<MonitorRecord | null> {
  return queued(async () => {
    const all = await readAll();
    const current = all[id];
    if (!current) return null;
    const next = applyMonitorEvent(current, event);
    await chrome.storage.session.set({ [SESSION_KEY]: { ...all, [id]: next } });
    return next;
  });
}

async function sendToTop(tabId: number, message: object): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

/** Starts a watch on a CSS selector in the top document. Throws when the tab cannot host the content script. */
export async function startMonitor(tabId: number, selector: string, timeoutMinutes: number): Promise<MonitorRecord> {
  const existing = await readAll();
  let id = newMonitorId();
  while (existing[id]) id = newMonitorId();
  const now = Date.now();
  const record: MonitorRecord = {
    id,
    tabId,
    selector,
    status: 'watching',
    startedAt: now,
    deadline: monitorDeadline(now, timeoutMinutes),
    changedText: '',
    updatedAt: now,
  };
  await sendToTop(tabId, { type: MONITOR_START_MESSAGE, id, selector });
  await queued(async () => {
    await chrome.storage.session.set({ [SESSION_KEY]: { ...(await readAll()), [id]: record } });
  });
  chrome.alarms.create(monitorAlarmName(id), { when: record.deadline });
  return record;
}

export async function stopMonitor(id: string): Promise<MonitorRecord | null> {
  const current = await getMonitor(id);
  if (!current) return null;
  if (isWatching(current)) {
    await sendToTop(current.tabId, { type: MONITOR_STOP_MESSAGE, id }).catch(() => undefined);
  }
  await chrome.alarms.clear(monitorAlarmName(id));
  return updateMonitor(id, { type: 'stopped', at: Date.now() });
}

/** Waits until the monitor leaves 'watching' or the timeout passes. Returns the latest record either way. */
export async function awaitMonitor(id: string, timeoutMs: number): Promise<MonitorRecord | null> {
  const started = Date.now();
  for (;;) {
    const record = await getMonitor(id);
    if (!record || !isWatching(record) || Date.now() - started >= timeoutMs) return record;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

/** Applies a terminal event. Only a change notifies the user; expiry and loss are visible in monitor_status. */
async function finish(id: string, event: MonitorEvent): Promise<void> {
  const record = await updateMonitor(id, event);
  await chrome.alarms.clear(monitorAlarmName(id));
  if (record?.status === 'changed' && event.type === 'changed') {
    await notifyTaskAttention('monitor', event.text);
  }
}

/** Registers the change, alarm and navigation listeners. Chrome needs them at top level in the worker. */
export function registerMonitorListeners(): void {
  chrome.storage.session.onChanged.addListener(changes => {
    const change = changes[SESSION_KEY];
    if (!change) return;
    watchedTabsFromEvents = true;
    watchedTabs = tabsWithWatches((change.newValue ?? {}) as Record<string, MonitorRecord>);
  });
  void readAll()
    .then(all => {
      if (!watchedTabsFromEvents) watchedTabs = tabsWithWatches(all);
    })
    .catch(error => logger.error('Failed to load watched tabs:', error));

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id) return false;
    const data = message as { type?: unknown; id?: unknown; text?: unknown };
    if (data?.type !== MONITOR_CHANGED_MESSAGE || typeof data.id !== 'string' || !isValidMonitorId(data.id)) {
      return false;
    }
    const id = data.id;
    const text = typeof data.text === 'string' ? data.text : '';
    const tabId = sender.tab.id;
    void getMonitor(id).then(record => {
      // Only the tab that owns the monitor may report on it.
      if (record?.tabId === tabId) return finish(id, { type: 'changed', text, at: Date.now() });
      return undefined;
    });
    return false;
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    const id = monitorIdFromAlarm(alarm.name);
    if (!id) return;
    void getMonitor(id)
      .then(async record => {
        if (!record || !isWatching(record)) return;
        await sendToTop(record.tabId, { type: MONITOR_STOP_MESSAGE, id }).catch(() => undefined);
        await finish(id, { type: 'expired', at: Date.now() });
      })
      .catch(error => logger.error('Failed to expire monitor:', error));
  });

  // A navigation or reload destroys the content-script observer, so the watch cannot report anymore.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading' || !watchedTabs.has(tabId)) return;
    void listMonitors()
      .then(records =>
        Promise.all(
          records
            .filter(r => r.tabId === tabId && isWatching(r))
            .map(r => finish(r.id, { type: 'lost', at: Date.now() })),
        ),
      )
      .catch(error => logger.error('Failed to mark monitors lost:', error));
  });
}
