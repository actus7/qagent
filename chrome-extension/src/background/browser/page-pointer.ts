export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// The JPEG frame size sits near the start of the file; 64 KB of base64-decoded bytes is far more than needed.
const JPEG_HEAD_BASE64_CHARS = 87384;

/** Reads width and height from the SOF segment of a JPEG. Returns null when the bytes are not a JPEG. */
export function parseJpegSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1;
      continue;
    }
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

/** Decodes the head of a base64 JPEG and returns its pixel size, or null when it cannot be read. */
export function readJpegSizeFromBase64(base64: string): Size | null {
  try {
    const head = atob(base64.slice(0, JPEG_HEAD_BASE64_CHARS).replace(/[^A-Za-z0-9+/=]/g, ''));
    const bytes = Uint8Array.from(head, char => char.charCodeAt(0));
    return parseJpegSize(bytes);
  } catch {
    return null;
  }
}

/**
 * Maps a point in screenshot pixels to CSS pixels of the viewport.
 * The screenshot may be captured at device pixel ratio, so the scale is viewport size / image size.
 */
export function screenshotPointToCss(point: Point, screenshot: Size | null, viewport: Size): Point {
  const scaleX = screenshot && screenshot.width > 0 ? viewport.width / screenshot.width : 1;
  const scaleY = screenshot && screenshot.height > 0 ? viewport.height / screenshot.height : 1;
  return { x: point.x * scaleX, y: point.y * scaleY };
}

export function isInsideViewport(point: Point, viewport: Size): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < viewport.width && point.y < viewport.height;
}

export function centerOfBox(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
