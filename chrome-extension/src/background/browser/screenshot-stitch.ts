// Fallback for full-page capture when CDP refuses: viewport tiles drawn into one OffscreenCanvas.
import type { CaptureTile } from './screenshot-tiles';

export interface TileGrab {
  /** Scrolls to the given offset and returns the viewport as base64 PNG. */
  grab(scrollY: number): Promise<string>;
}

async function decodeBase64Png(base64: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

async function encodeBase64Png(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Draws each tile's rows at their page position. Rows that a tile did not scroll to are skipped, not duplicated. */
export async function stitchTiles(
  tiles: CaptureTile[],
  grabber: TileGrab,
  size: { width: number; height: number; viewportWidth: number },
): Promise<string> {
  const canvas = new OffscreenCanvas(size.viewportWidth, size.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available for the full-page capture');
  for (const tile of tiles) {
    const bitmap = await decodeBase64Png(await grabber.grab(tile.scrollY));
    // Tile bitmaps are device pixels; the canvas is in CSS pixels, so the source rectangle is scaled down.
    const k = bitmap.width / size.viewportWidth;
    context.drawImage(
      bitmap,
      0,
      tile.sourceY * k,
      bitmap.width,
      tile.height * k,
      0,
      tile.pageY,
      size.viewportWidth,
      tile.height,
    );
    bitmap.close();
  }
  return encodeBase64Png(canvas);
}
