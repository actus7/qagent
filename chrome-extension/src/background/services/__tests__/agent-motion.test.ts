import { describe, expect, it } from 'vitest';
import {
  curvedPathPoint,
  easeInOutCubic,
  GLIDE_MAX_MS,
  GLIDE_MIN_MS,
  glideDurationMs,
  glideFrame,
} from '@extension/shared';

describe('easeInOutCubic', () => {
  it('starts at 0, ends at 1 and passes the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it('clamps out-of-range progress and stays monotonic', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    let previous = 0;
    for (let step = 1; step <= 20; step++) {
      const value = easeInOutCubic(step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('glideDurationMs', () => {
  it('stays within 300-450 ms regardless of distance', () => {
    expect(glideDurationMs({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(GLIDE_MIN_MS);
    expect(glideDurationMs({ x: 0, y: 0 }, { x: 40, y: 0 })).toBeGreaterThan(GLIDE_MIN_MS);
    expect(glideDurationMs({ x: 0, y: 0 }, { x: 5000, y: 5000 })).toBe(GLIDE_MAX_MS);
  });
});

describe('curvedPathPoint', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 300, y: 0 };

  it('starts at the origin and ends exactly on the target', () => {
    expect(curvedPathPoint(from, to, 0)).toEqual(from);
    const end = curvedPathPoint(from, to, 1);
    expect(end.x).toBeCloseTo(300, 10);
    expect(end.y).toBeCloseTo(0, 10);
  });

  it('bows off the straight line in the middle of a long move', () => {
    const middle = curvedPathPoint(from, to, 0.5);
    expect(middle.x).toBeCloseTo(150, 10);
    expect(Math.abs(middle.y)).toBeGreaterThan(1);
    expect(Math.abs(middle.y)).toBeLessThanOrEqual(80 / 2 + 1e-9);
  });

  it('stays on the spot for a zero-length move', () => {
    expect(curvedPathPoint({ x: 7, y: 9 }, { x: 7, y: 9 }, 0.5)).toEqual({ x: 7, y: 9 });
  });
});

describe('glideFrame', () => {
  it('reports completion at the duration and lands on the target', () => {
    const from = { x: 10, y: 10 };
    const to = { x: 210, y: 110 };
    const midway = glideFrame(from, to, 100, 400);
    expect(midway.done).toBe(false);
    const finished = glideFrame(from, to, 400, 400);
    expect(finished.done).toBe(true);
    expect(finished.point.x).toBeCloseTo(210, 10);
    expect(finished.point.y).toBeCloseTo(110, 10);
  });

  it('jumps straight to the target when the duration is zero', () => {
    expect(glideFrame({ x: 0, y: 0 }, { x: 50, y: 50 }, 0, 0)).toEqual({
      point: { x: 50, y: 50 },
      done: true,
    });
  });
});
