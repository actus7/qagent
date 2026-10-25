import { describe, expect, it } from 'vitest';
import {
  describeMonitorChange,
  hasMonitorChanged,
  normalizeMonitorText,
} from '@extension/shared/lib/utils/monitor-text';
import {
  applyMonitorEvent,
  isValidMonitorId,
  monitorIdFromAlarm,
  newMonitorId,
  type MonitorRecord,
} from '../monitor-logic';
import { createDownloadWatch, settledDownload, watchOnChanged, watchOnCreated } from '../download-logic';

const record: MonitorRecord = {
  id: 'mon-abc123',
  tabId: 7,
  selector: '#feed',
  status: 'watching',
  startedAt: 0,
  deadline: 60_000,
  changedText: '',
  updatedAt: 0,
};

describe('monitor text diffing', () => {
  it('treats whitespace-only differences as no change', () => {
    expect(hasMonitorChanged('Order  ready\n', 'Order ready')).toBe(false);
  });

  it('reports a text change and shows where it starts', () => {
    expect(hasMonitorChanged('status: pending', 'status: shipped')).toBe(true);
    expect(describeMonitorChange('status: pending', 'status: shipped')).toContain('shipped');
  });

  it('caps long text', () => {
    expect(normalizeMonitorText('a'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('monitor records', () => {
  it('moves a watching monitor to changed and keeps the text', () => {
    const next = applyMonitorEvent(record, { type: 'changed', text: 'v2', at: 5 });
    expect(next).toMatchObject({ status: 'changed', changedText: 'v2', updatedAt: 5 });
  });

  it('keeps the first outcome once a monitor has ended', () => {
    const changed = applyMonitorEvent(record, { type: 'changed', text: 'v2', at: 5 });
    expect(applyMonitorEvent(changed, { type: 'expired', at: 9 })).toBe(changed);
  });

  it('marks a monitor lost when its page navigates', () => {
    expect(applyMonitorEvent(record, { type: 'lost', at: 3 }).status).toBe('lost');
  });

  it('builds valid ids and maps alarm names back to them', () => {
    const id = newMonitorId(() => 0.5);
    expect(isValidMonitorId(id)).toBe(true);
    expect(monitorIdFromAlarm(`qagent-monitor:${id}`)).toBe(id);
    expect(monitorIdFromAlarm('qagent-schedule:x')).toBeNull();
  });

  it('rejects ids outside the expected shape', () => {
    expect(isValidMonitorId('mon-ABC')).toBe(false);
    expect(isValidMonitorId('../etc')).toBe(false);
  });
});

describe('download watch', () => {
  const armedAt = Date.parse('2026-10-25T12:00:00Z');

  it('tracks a download that starts after arming and settles on complete', () => {
    let watch = createDownloadWatch(armedAt);
    watch = watchOnCreated(watch, {
      id: 4,
      url: 'https://example.test/report.csv',
      filename: '',
      state: 'in_progress',
      startTime: '2026-10-25T12:00:01Z',
    });
    expect(settledDownload(watch)).toBeNull();
    watch = watchOnChanged(watch, { id: 4, state: { current: 'complete' }, filename: { current: 'C:/dl/report.csv' } });
    expect(settledDownload(watch)).toMatchObject({ id: 4, state: 'complete', filename: 'C:/dl/report.csv' });
  });

  it('ignores downloads that started before the watch was armed', () => {
    const watch = watchOnCreated(createDownloadWatch(armedAt), {
      id: 1,
      url: 'https://example.test/old.zip',
      filename: 'C:/dl/old.zip',
      state: 'complete',
      startTime: '2026-10-25T11:00:00Z',
    });
    expect(watch.downloads).toEqual({});
  });

  it('settles an interrupted download as well', () => {
    let watch = watchOnCreated(createDownloadWatch(armedAt), {
      id: 2,
      url: 'https://example.test/x',
      filename: '',
      state: 'in_progress',
      startTime: '2026-10-25T12:00:02Z',
    });
    watch = watchOnChanged(watch, { id: 2, state: { current: 'interrupted' } });
    expect(settledDownload(watch)?.state).toBe('interrupted');
  });

  it('ignores change events for downloads it did not track', () => {
    const watch = createDownloadWatch(armedAt);
    expect(watchOnChanged(watch, { id: 99, state: { current: 'complete' } })).toBe(watch);
  });
});
