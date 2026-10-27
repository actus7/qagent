import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import type { ScheduleTiming } from './nextRun';
import { upsertById } from '../base/collection';

export type ScheduleMode = 'act' | 'plan' | 'chat';
export type ScheduleRunOutcome = 'completed' | 'failed' | 'cancelled' | 'skipped' | 'blocked';

export interface ScheduleRun {
  at: number;
  outcome: ScheduleRunOutcome;
  /** Chat session that holds the run's conversation; null when the run never started. */
  sessionId: string | null;
  detail: string;
}

export interface ScheduledTask extends ScheduleTiming {
  id: string;
  name: string;
  prompt: string;
  mode: ScheduleMode;
  /** Page opened in a background tab before the run. Required for act mode. */
  startUrl: string | null;
  enabled: boolean;
  nextRunAt: number | null;
  createdAt: number;
  history: ScheduleRun[];
}

export interface ScheduledTasksConfig {
  tasks: ScheduledTask[];
}

export const SCHEDULE_HISTORY_LIMIT = 10;
export const SCHEDULE_LIMIT = 20;
const SCHEDULE_LIMIT_ERROR = `Schedule limit reached (${SCHEDULE_LIMIT}). Delete a scheduled task before adding another.`;

type ScheduledTasksStorage = BaseStorage<ScheduledTasksConfig> & {
  getTasks: () => Promise<ScheduledTask[]>;
  getTask: (id: string) => Promise<ScheduledTask | undefined>;
  /** Inserts the task, or replaces the stored task with the same id. */
  saveTask: (task: ScheduledTask) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  /** Appends a run to the task history, keeping only the latest SCHEDULE_HISTORY_LIMIT entries. */
  appendRun: (id: string, run: ScheduleRun) => Promise<void>;
};

const DEFAULT_SCHEDULED_TASKS: ScheduledTasksConfig = { tasks: [] };

const storage = createStorage<ScheduledTasksConfig>('scheduled-tasks', DEFAULT_SCHEDULED_TASKS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/** Accepts only absolute http or https URLs. Returns the normalized URL, or null for anything else. */
export function normalizeStartUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export const scheduledTasksStore: ScheduledTasksStorage = {
  ...storage,
  async getTasks() {
    const config = (await storage.get()) || DEFAULT_SCHEDULED_TASKS;
    return config.tasks;
  },
  async getTask(id: string) {
    return (await this.getTasks()).find(task => task.id === id);
  },
  async saveTask(task: ScheduledTask) {
    await storage.set(prev => ({ tasks: upsertById(prev.tasks, task, SCHEDULE_LIMIT, SCHEDULE_LIMIT_ERROR) }));
  },
  async removeTask(id: string) {
    await storage.set(prev => ({ tasks: prev.tasks.filter(task => task.id !== id) }));
  },
  async appendRun(id: string, run: ScheduleRun) {
    await storage.set(prev => ({
      tasks: prev.tasks.map(task =>
        task.id === id ? { ...task, history: [...task.history, run].slice(-SCHEDULE_HISTORY_LIMIT) } : task,
      ),
    }));
  },
};
