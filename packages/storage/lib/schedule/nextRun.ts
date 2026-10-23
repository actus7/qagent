// Next-run computation for scheduled tasks. Everything uses the local calendar fields of the Date constructor,
// so the schedule follows the user's timezone and DST without any UTC offset arithmetic.

export type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly';

export interface ScheduleTiming {
  frequency: ScheduleFrequency;
  /** Local wall-clock time, HH:mm. */
  time: string;
  /** Local calendar date, YYYY-MM-DD. Used by 'once'. */
  date: string | null;
  /** 0 (Sunday) to 6 (Saturday). Used by 'weekly'. */
  weekday: number;
  /** 1 to 31. Used by 'monthly'; in months with fewer days the task runs on the last day. */
  dayOfMonth: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTiming(timing: ScheduleTiming): boolean {
  if (!TIME_PATTERN.test(timing.time)) return false;
  if (!Number.isInteger(timing.weekday) || timing.weekday < 0 || timing.weekday > 6) return false;
  if (!Number.isInteger(timing.dayOfMonth) || timing.dayOfMonth < 1 || timing.dayOfMonth > 31) return false;
  if (timing.frequency === 'once') return parseLocalDate(timing.date) !== null;
  return ['daily', 'weekly', 'monthly'].includes(timing.frequency);
}

/** Returns the next local instant (ms) after `fromMs` at which the task should run, or null when it never will. */
export function computeNextRunAt(timing: ScheduleTiming, fromMs: number): number | null {
  if (!isValidTiming(timing)) return null;
  const [hours, minutes] = timing.time.split(':').map(Number);
  const at = (year: number, month: number, day: number): Date => new Date(year, month, day, hours, minutes, 0, 0);

  if (timing.frequency === 'once') {
    const date = parseLocalDate(timing.date);
    if (!date) return null;
    const when = at(date.year, date.month - 1, date.day).getTime();
    return when > fromMs ? when : null;
  }

  const now = new Date(fromMs);
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (timing.frequency === 'daily') {
    const today = at(year, month, day).getTime();
    return today > fromMs ? today : at(year, month, day + 1).getTime();
  }

  if (timing.frequency === 'weekly') {
    // Eight candidates cover a full week, including today when the time has already passed.
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = at(year, month, day + offset);
      if (candidate.getDay() === timing.weekday && candidate.getTime() > fromMs) return candidate.getTime();
    }
    return null;
  }

  // Monthly: the current month first, then the following ones, clamping the day to the month's length.
  for (let offset = 0; offset <= 2; offset++) {
    const firstOfMonth = new Date(year, month + offset, 1);
    const daysInMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();
    const candidate = at(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), Math.min(timing.dayOfMonth, daysInMonth));
    if (candidate.getTime() > fromMs) return candidate.getTime();
  }
  return null;
}

function parseLocalDate(value: string | null): { year: number; month: number; day: number } | null {
  const match = value ? DATE_PATTERN.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(year, month - 1, day);
  // Rejects impossible dates such as 2026-02-31, which the Date constructor would roll over.
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return { year, month, day };
}
