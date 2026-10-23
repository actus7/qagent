// Attachment limits and validation shared by the side panel (pre-send checks) and the background (trust boundary).

export const ASSISTANT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const ASSISTANT_MAX_IMAGES = 5;
export const ASSISTANT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ASSISTANT_IMAGE_MAX_LONG_SIDE = 1568;
export const ASSISTANT_MAX_FILES = 5;
export const ASSISTANT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i;

export type AssistantAttachmentKind = 'image' | 'file';

/** A user attachment carried from the panel to the background for one task. */
export interface AssistantAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: AssistantAttachmentKind;
  /** base64 data URL, e.g. `data:image/png;base64,...` */
  dataUrl: string;
}

export const isAssistantImageMimeType = (mimeType: string): boolean =>
  (ASSISTANT_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);

/** Splits a base64 data URL; returns null when the string is not a well-formed base64 data URL. */
export function parseBase64DataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), base64: match[2] };
}

/** Exact decoded size of a base64 payload (padding aware). */
export function decodedBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Scales width/height so the longest side is at most maxLongSide; never upscales. */
export function fitWithin(width: number, height: number, maxLongSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxLongSide || longest <= 0) return { width, height };
  const scale = maxLongSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Maps a selection drawn on a displayed image back to natural image pixels, clamped to the image.
 * Returns null when the selection is empty (a click without dragging keeps the full image).
 */
export function cropRectFromSelection(
  selection: PixelRect,
  displaySize: { width: number; height: number },
  naturalSize: { width: number; height: number },
): PixelRect | null {
  if (displaySize.width <= 0 || displaySize.height <= 0) return null;
  const scaleX = naturalSize.width / displaySize.width;
  const scaleY = naturalSize.height / displaySize.height;
  const x = Math.max(0, Math.min(selection.x, selection.x + selection.width));
  const y = Math.max(0, Math.min(selection.y, selection.y + selection.height));
  const right = Math.min(displaySize.width, Math.max(selection.x, selection.x + selection.width));
  const bottom = Math.min(displaySize.height, Math.max(selection.y, selection.y + selection.height));
  const width = Math.round((right - x) * scaleX);
  const height = Math.round((bottom - y) * scaleY);
  if (width < 2 || height < 2) return null;
  return {
    x: Math.round(x * scaleX),
    y: Math.round(y * scaleY),
    width: Math.min(width, naturalSize.width),
    height: Math.min(height, naturalSize.height),
  };
}

/** Returns a human-readable reason when the attachment list is invalid, or null when it is acceptable. */
export function getAssistantAttachmentError(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return 'attachments must be an array';
  const images = attachments.filter(item => item?.kind === 'image');
  const files = attachments.filter(item => item?.kind === 'file');
  if (images.length + files.length !== attachments.length) return 'unknown attachment kind';
  if (images.length > ASSISTANT_MAX_IMAGES) return `at most ${ASSISTANT_MAX_IMAGES} images`;
  if (files.length > ASSISTANT_MAX_FILES) return `at most ${ASSISTANT_MAX_FILES} files`;

  for (const item of attachments as Array<Record<string, unknown>>) {
    if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 64) return 'invalid attachment id';
    if (typeof item.name !== 'string' || item.name.trim().length === 0 || item.name.length > MAX_NAME_LENGTH) {
      return 'invalid attachment name';
    }
    if (/[\\/\0]/.test(item.name)) return 'attachment name must not contain path separators';
    if (typeof item.dataUrl !== 'string') return 'invalid attachment data';
    const parsed = parseBase64DataUrl(item.dataUrl);
    if (!parsed) return 'attachment data must be a base64 data URL';
    if (typeof item.mimeType !== 'string' || item.mimeType.toLowerCase() !== parsed.mimeType) {
      return 'attachment mime type does not match its data';
    }
    const bytes = decodedBase64Bytes(parsed.base64);
    if (item.kind === 'image') {
      if (!isAssistantImageMimeType(parsed.mimeType)) return 'unsupported image type';
      if (bytes > ASSISTANT_MAX_IMAGE_BYTES) return 'image is larger than 5 MB';
    } else {
      if (bytes > ASSISTANT_MAX_FILE_BYTES) return 'file is larger than 10 MB';
    }
  }
  return null;
}

export const isValidAssistantAttachments = (attachments: unknown): attachments is AssistantAttachment[] =>
  getAssistantAttachmentError(attachments) === null;
