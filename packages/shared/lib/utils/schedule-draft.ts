// Form model for scheduled tasks, shared by the options page and the side panel dialog.
// Pure functions only: validation returns error codes so each page translates them with its own i18n keys.
import {
  computeNextRunAt,
  isValidTiming,
  normalizeStartUrl,
  type ScheduledTask,
  type ScheduleFrequency,
  type ScheduleMode,
} from '@extension/storage';

export interface ScheduleDraft {
  prompt: string;
  mode: ScheduleMode;
  startUrl: string;
  enabled: boolean;
  frequency: ScheduleFrequency;
  /** Local wall-clock time, HH:mm. */
  time: string;
  /** Local calendar date, YYYY-MM-DD. Used by 'once'. */
  date: string;
  /** 0 (Sunday) to 6 (Saturday). Used by 'weekly'. */
  weekday: number;
  /** 1 to 31. Used by 'monthly'. */
  dayOfMonth: number;
}

export type ScheduleDraftErrorCode =
  'promptRequired' | 'startUrlRequired' | 'startUrlInvalid' | 'timeInvalid' | 'dateInvalid' | 'dateInPast';

export type ScheduleDraftErrors = Partial<Record<'prompt' | 'startUrl' | 'time' | 'date', ScheduleDraftErrorCode>>;

const SCHEDULE_NAME_MAX_LENGTH = 60;
export const SCHEDULE_PROMPT_MAX_LENGTH = 4000;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD, the format of `<input type="date">`. */
export function toLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local wall-clock time as HH:mm, the format of `<input type="time">`. */
export function toLocalTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A new schedule defaults to a daily run at the next full hour, so it never starts in the past. */
export function createScheduleDraft(now: Date, overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  return {
    prompt: '',
    mode: 'act',
    startUrl: '',
    enabled: true,
    frequency: 'daily',
    time: toLocalTimeInput(nextHour),
    date: toLocalDateInput(tomorrow),
    weekday: now.getDay(),
    dayOfMonth: now.getDate(),
    ...overrides,
  };
}

export function draftFromTask(task: ScheduledTask): ScheduleDraft {
  return {
    prompt: task.prompt,
    mode: task.mode,
    startUrl: task.startUrl ?? '',
    enabled: task.enabled,
    frequency: task.frequency,
    time: task.time,
    date: task.date ?? '',
    weekday: task.weekday,
    dayOfMonth: task.dayOfMonth,
  };
}

function timingOf(draft: ScheduleDraft) {
  return {
    frequency: draft.frequency,
    time: draft.time,
    date: draft.frequency === 'once' ? draft.date : null,
    weekday: draft.weekday,
    dayOfMonth: draft.dayOfMonth,
  };
}

/** Checks every field and computes the next run. nextRunAt is null when the draft has errors. */
export function validateScheduleDraft(
  draft: ScheduleDraft,
  nowMs: number,
): { errors: ScheduleDraftErrors; nextRunAt: number | null } {
  const errors: ScheduleDraftErrors = {};
  if (!draft.prompt.trim()) errors.prompt = 'promptRequired';

  const trimmedUrl = draft.startUrl.trim();
  if (draft.mode === 'act' && !trimmedUrl) errors.startUrl = 'startUrlRequired';
  else if (trimmedUrl && !normalizeStartUrl(trimmedUrl)) errors.startUrl = 'startUrlInvalid';

  const timing = timingOf(draft);
  if (!isValidTiming(timing)) {
    if (draft.frequency === 'once' && !errors.time) errors.date = 'dateInvalid';
    else errors.time = 'timeInvalid';
  }

  if (Object.keys(errors).length > 0) return { errors, nextRunAt: null };
  const nextRunAt = computeNextRunAt(timing, nowMs);
  // Only a one-time schedule can be valid yet have no future run: its date is already past.
  if (nextRunAt === null) return { errors: { date: 'dateInPast' }, nextRunAt: null };
  return { errors, nextRunAt };
}

/** Name shown in lists and the report: the first line of the prompt, shortened. */
export function scheduleNameFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? '';
  return firstLine.length > SCHEDULE_NAME_MAX_LENGTH
    ? `${firstLine.slice(0, SCHEDULE_NAME_MAX_LENGTH - 1)}…`
    : firstLine;
}

/**
 * Turns a valid draft into the stored task. `existing` keeps the id, creation time and run history of an edited
 * schedule. Returns null when the draft does not validate, so callers never store an invalid schedule.
 */
export function scheduleFromDraft(
  draft: ScheduleDraft,
  options: { id: string; nowMs: number; existing?: ScheduledTask },
): ScheduledTask | null {
  const { errors, nextRunAt } = validateScheduleDraft(draft, options.nowMs);
  if (Object.keys(errors).length > 0) return null;
  const timing = timingOf(draft);
  return {
    id: options.existing?.id ?? options.id,
    name: scheduleNameFromPrompt(draft.prompt),
    prompt: draft.prompt.trim(),
    mode: draft.mode,
    startUrl: normalizeStartUrl(draft.startUrl),
    enabled: draft.enabled,
    frequency: timing.frequency,
    time: timing.time,
    date: timing.date,
    weekday: timing.weekday,
    dayOfMonth: timing.dayOfMonth,
    nextRunAt,
    createdAt: options.existing?.createdAt ?? options.nowMs,
    history: options.existing?.history ?? [],
  };
}
