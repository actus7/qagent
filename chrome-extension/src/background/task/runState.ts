import { Actors, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { buildTaskMemory } from '../agent/task-memory';
import { createLogger } from '../log';

const logger = createLogger('background');

export const RUNNING_TASK_KEY = 'running_assistant_task';
// Chrome stops an idle MV3 service worker after about 30 seconds; any extension API call resets that timer.
const KEEP_ALIVE_INTERVAL_MS = 20_000;

export interface RunningTaskRecord {
  taskId: string;
  task: string;
  mode: string;
  tabIds: number[];
  stepCount: number;
  status: 'running' | 'interrupted';
  startedAt: number;
}

export type SessionStorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

export interface RecoveryDeps {
  area?: SessionStorageArea;
  saveMemory: (sessionId: string, memory: string) => Promise<void>;
  addNotice: (sessionId: string, content: string) => Promise<void>;
}

function isRunningTaskRecord(value: unknown): value is RunningTaskRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<Record<keyof RunningTaskRecord, unknown>>;
  return (
    typeof record.taskId === 'string' &&
    typeof record.task === 'string' &&
    typeof record.mode === 'string' &&
    Array.isArray(record.tabIds) &&
    typeof record.stepCount === 'number' &&
    (record.status === 'running' || record.status === 'interrupted') &&
    typeof record.startedAt === 'number'
  );
}

export async function saveRunningTask(record: RunningTaskRecord, area: SessionStorageArea = chrome.storage.session) {
  await area.set({ [RUNNING_TASK_KEY]: record });
}

export async function readRunningTask(area: SessionStorageArea = chrome.storage.session) {
  const stored: unknown = (await area.get(RUNNING_TASK_KEY))[RUNNING_TASK_KEY];
  return isRunningTaskRecord(stored) ? stored : null;
}

export async function updateRunningTaskSteps(stepCount: number, area: SessionStorageArea = chrome.storage.session) {
  const record = await readRunningTask(area);
  if (!record || record.status !== 'running' || stepCount <= record.stepCount) return;
  await saveRunningTask({ ...record, stepCount }, area);
}

export async function clearRunningTask(area: SessionStorageArea = chrome.storage.session) {
  await area.remove(RUNNING_TASK_KEY);
}

function defaultRecoveryDeps(): RecoveryDeps {
  return {
    saveMemory: (sessionId, memory) => chatHistoryStore.setTaskMemory(sessionId, memory),
    addNotice: (sessionId, content) =>
      chatHistoryStore
        .addMessage(sessionId, { actor: Actors.SYSTEM, content, timestamp: Date.now(), kind: 'interrupted' })
        .then(() => {}),
  };
}

/**
 * Runs at service-worker startup. A record still marked "running" can only come from a worker that died mid-task,
 * because a live worker clears it in the task's finally block. The task is marked interrupted, its context is kept
 * as follow-up memory, and the chat gets a notice that a follow-up resumes it.
 */
export async function recoverInterruptedTask(
  deps: RecoveryDeps = defaultRecoveryDeps(),
): Promise<RunningTaskRecord | null> {
  const area = deps.area ?? chrome.storage.session;
  const record = await readRunningTask(area);
  if (!record || record.status !== 'running') return null;

  const interrupted: RunningTaskRecord = { ...record, status: 'interrupted' };
  await saveRunningTask(interrupted, area);
  // ponytail: the action log lives in memory only, so the recovered memory carries no action results.
  await deps.saveMemory(
    record.taskId,
    buildTaskMemory({ task: record.task, outcome: 'interrupted', finalAnswer: null, url: null, actions: [] }),
  );
  await deps.addNotice(record.taskId, t('bg_task_interruptedByRestart'));
  logger.warning(`Task ${record.taskId} was interrupted by a service-worker restart at step ${record.stepCount}`);
  return interrupted;
}

/** Pings an extension API on an interval so Chrome does not stop the worker during a long task. */
export function startServiceWorkerKeepAlive(): () => void {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, KEEP_ALIVE_INTERVAL_MS);
  return () => clearInterval(timer);
}
