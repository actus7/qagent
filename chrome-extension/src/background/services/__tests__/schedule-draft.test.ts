import { describe, expect, it, vi } from 'vitest';

// The storage package pulls in the extension polyfill, which only loads inside an extension.
vi.mock('webextension-polyfill', () => ({}));
import {
  createScheduleDraft,
  scheduleFromDraft,
  scheduleNameFromPrompt,
  validateScheduleDraft,
  type ScheduleDraft,
} from '@extension/shared';
import type { ScheduledTask } from '@extension/storage';

// Local-time constructors keep these expectations valid in any timezone.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = local(2026, 3, 10, 8, 0);

const draft = (overrides: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  ...createScheduleDraft(new Date(NOW)),
  prompt: 'Click the Go button',
  mode: 'act',
  startUrl: 'https://example.com/page',
  frequency: 'daily',
  time: '09:00',
  ...overrides,
});

describe('validateScheduleDraft', () => {
  it('computes the next run for a valid daily draft', () => {
    const result = validateScheduleDraft(draft(), NOW);

    expect(result.errors).toEqual({});
    expect(result.nextRunAt).toBe(local(2026, 3, 10, 9, 0));
  });

  it('requires a prompt and a start URL in act mode', () => {
    expect(validateScheduleDraft(draft({ prompt: '  ' }), NOW).errors.prompt).toBe('promptRequired');
    expect(validateScheduleDraft(draft({ startUrl: '' }), NOW).errors.startUrl).toBe('startUrlRequired');
  });

  it('accepts an empty start URL outside act mode', () => {
    expect(validateScheduleDraft(draft({ mode: 'chat', startUrl: '' }), NOW).errors).toEqual({});
  });

  it('rejects non-http start URLs', () => {
    for (const startUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'not a url']) {
      expect(validateScheduleDraft(draft({ startUrl }), NOW).errors.startUrl).toBe('startUrlInvalid');
    }
  });

  it('rejects a one-time schedule whose date has passed', () => {
    const result = validateScheduleDraft(draft({ frequency: 'once', date: '2026-03-09' }), NOW);

    expect(result.errors.date).toBe('dateInPast');
    expect(result.nextRunAt).toBeNull();
  });

  it('rejects impossible dates and times', () => {
    expect(validateScheduleDraft(draft({ frequency: 'once', date: '2026-02-31' }), NOW).errors.date).toBe(
      'dateInvalid',
    );
    expect(validateScheduleDraft(draft({ time: '25:00' }), NOW).errors.time).toBe('timeInvalid');
  });
});

describe('scheduleFromDraft', () => {
  it('returns null for an invalid draft so an invalid schedule is never stored', () => {
    expect(scheduleFromDraft(draft({ prompt: '' }), { id: 'a', nowMs: NOW })).toBeNull();
  });

  it('keeps the id, creation time and history of an edited schedule', () => {
    const existing: ScheduledTask = {
      id: 'keep-me',
      name: 'old',
      prompt: 'old',
      mode: 'act',
      startUrl: 'https://example.com',
      enabled: true,
      frequency: 'daily',
      time: '07:00',
      date: null,
      weekday: 0,
      dayOfMonth: 1,
      nextRunAt: null,
      createdAt: 111,
      history: [{ at: 5, outcome: 'completed', sessionId: 's', detail: '' }],
    };

    const task = scheduleFromDraft(draft({ time: '10:30' }), { id: 'ignored', nowMs: NOW, existing });

    expect(task).toMatchObject({
      id: 'keep-me',
      createdAt: 111,
      history: existing.history,
      time: '10:30',
      nextRunAt: local(2026, 3, 10, 10, 30),
    });
  });

  it('stores the normalized start URL and a trimmed prompt', () => {
    const task = scheduleFromDraft(draft({ prompt: '  Go  ', startUrl: ' https://example.com/x ' }), {
      id: 'a',
      nowMs: NOW,
    });

    expect(task?.prompt).toBe('Go');
    expect(task?.startUrl).toBe('https://example.com/x');
  });
});

describe('scheduleNameFromPrompt', () => {
  it('uses the first line and shortens long names', () => {
    expect(scheduleNameFromPrompt('First line\nsecond')).toBe('First line');
    expect(scheduleNameFromPrompt('x'.repeat(100))).toHaveLength(60);
  });
});
