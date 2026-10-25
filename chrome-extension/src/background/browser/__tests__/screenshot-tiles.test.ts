import { describe, expect, it } from 'vitest';
import { captureHeightFor, MAX_CAPTURE_PX, planScreenshotTiles } from '../screenshot-tiles';

describe('planScreenshotTiles', () => {
  it('covers every page row exactly once', () => {
    const tiles = planScreenshotTiles(2500, 1000);
    const covered = tiles.flatMap(tile => Array.from({ length: tile.height }, (_, row) => tile.pageY + row));
    expect(covered).toEqual(Array.from({ length: 2500 }, (_, row) => row));
  });

  it('clamps the last scroll to the bottom and offsets the rows inside the viewport capture', () => {
    const tiles = planScreenshotTiles(2500, 1000);
    expect(tiles.at(-1)).toEqual({ scrollY: 1500, pageY: 2000, height: 500, sourceY: 500 });
  });

  it('returns a single tile for a page that fits the viewport', () => {
    expect(planScreenshotTiles(600, 800)).toEqual([{ scrollY: 0, pageY: 0, height: 600, sourceY: 0 }]);
  });

  it('returns no tiles for an empty page or a missing viewport', () => {
    expect(planScreenshotTiles(0, 800)).toEqual([]);
    expect(planScreenshotTiles(800, 0)).toEqual([]);
  });
});

describe('captureHeightFor', () => {
  it('keeps a page within the capture limit whole', () => {
    expect(captureHeightFor(3000)).toEqual({ height: 3000, truncated: false });
  });

  it('caps a page above the limit and reports the cut', () => {
    expect(captureHeightFor(MAX_CAPTURE_PX + 500)).toEqual({ height: MAX_CAPTURE_PX, truncated: true });
  });
});
