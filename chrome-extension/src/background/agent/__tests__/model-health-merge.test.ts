import { describe, expect, it } from 'vitest';
import { mergeModelHealth, type ModelHealth } from '../model-failover';

describe('mergeModelHealth', () => {
  it('keeps the results both writers recorded for different models', () => {
    const stored: ModelHealth = { 'p:a': { ok: 2, fail: 0, lastOk: 100 } };
    const navigatorSnapshot: ModelHealth = { 'p:a': { ok: 2, fail: 1, lastFail: 200 } };
    const plannerSnapshot: ModelHealth = { 'p:b': { ok: 1, fail: 0, lastOk: 150 } };

    const afterNavigator = mergeModelHealth(stored, navigatorSnapshot);
    const afterPlanner = mergeModelHealth(afterNavigator, plannerSnapshot);

    expect(afterPlanner).toEqual({
      'p:a': { ok: 2, fail: 1, lastOk: 100, lastFail: 200 },
      'p:b': { ok: 1, fail: 0, lastOk: 150 },
    });
  });

  it('does not let an older snapshot roll counters back', () => {
    const stored: ModelHealth = { 'p:a': { ok: 5, fail: 3, lastOk: 500, lastFail: 400 } };
    const staleSnapshot: ModelHealth = { 'p:a': { ok: 4, fail: 3, lastOk: 300 } };

    expect(mergeModelHealth(stored, staleSnapshot)).toEqual({
      'p:a': { ok: 5, fail: 3, lastOk: 500, lastFail: 400 },
    });
  });

  it('returns the stored value unchanged when the snapshot is empty', () => {
    const stored: ModelHealth = { 'p:a': { ok: 1, fail: 0, lastOk: 10 } };
    expect(mergeModelHealth(stored, {})).toEqual(stored);
  });
});
