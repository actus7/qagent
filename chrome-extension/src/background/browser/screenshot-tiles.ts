// Full-page capture planning. Pure, so the coverage rules are testable without a browser.

/** Largest side a single capture may cover; beyond this browsers refuse or run out of memory. */
export const MAX_CAPTURE_PX = 16384;

export interface CaptureTile {
  /** Scroll position to request. The browser clamps it at the end of the page. */
  scrollY: number;
  /** Where this tile's rows start on the full page. */
  pageY: number;
  /** Rows of the page this tile contributes. */
  height: number;
  /** Row inside the viewport capture where those rows start (non-zero when the scroll was clamped). */
  sourceY: number;
}

/**
 * Splits the page into viewport-sized tiles. Each page row is covered exactly once; the last tile is scrolled
 * to the bottom, so its rows sit lower in the viewport capture (sourceY) and the rest of the capture is unused.
 */
export function planScreenshotTiles(contentHeight: number, viewportHeight: number): CaptureTile[] {
  if (contentHeight <= 0 || viewportHeight <= 0) return [];
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const tiles: CaptureTile[] = [];
  for (let pageY = 0; pageY < contentHeight; pageY += viewportHeight) {
    const scrollY = Math.min(pageY, maxScroll);
    tiles.push({
      scrollY,
      pageY,
      height: Math.min(viewportHeight, contentHeight - pageY),
      sourceY: pageY - scrollY,
    });
  }
  return tiles;
}

/** Height a capture may cover: the whole page up to MAX_CAPTURE_PX, and whether the page was cut short. */
export function captureHeightFor(contentHeight: number): { height: number; truncated: boolean } {
  const height = Math.min(Math.max(0, contentHeight), MAX_CAPTURE_PX);
  return { height, truncated: contentHeight > MAX_CAPTURE_PX };
}
