import { describe, expect, it } from 'vitest';
import { tabsWithWatches, type MonitorRecord } from '../monitor-logic';

const record = (id: string, tabId: number, status: MonitorRecord['status']): MonitorRecord => ({
  id,
  tabId,
  selector: '.price',
  status,
  startedAt: 0,
  deadline: 0,
  changedText: '',
  updatedAt: 0,
});

describe('tabsWithWatches', () => {
  it('returns no tabs when there are no monitors', () => {
    expect(tabsWithWatches({})).toEqual(new Set());
  });

  it('returns only the tabs whose monitor is still watching', () => {
    const records = {
      a: record('a', 1, 'watching'),
      b: record('b', 2, 'changed'),
      c: record('c', 3, 'stopped'),
      d: record('d', 4, 'watching'),
    };
    expect(tabsWithWatches(records)).toEqual(new Set([1, 4]));
  });
});
