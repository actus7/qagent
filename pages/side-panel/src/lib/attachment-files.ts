import {
  ASSISTANT_IMAGE_MIME_TYPES,
  ASSISTANT_IMAGE_MAX_LONG_SIDE,
  ASSISTANT_MAX_FILE_BYTES,
  ASSISTANT_MAX_IMAGE_BYTES,
  decodedBase64Bytes,
  fitWithin,
  isAssistantImageMimeType,
  type AssistantAttachment,
  type PixelRect,
} from '@extension/shared';

export type AttachmentReadError = 'imageUnsupported' | 'imageTooLarge' | 'fileTooLarge';

export class AttachmentReadFailure extends Error {
  constructor(readonly reason: AttachmentReadError) {
    super(reason);
  }
}

const JPEG_QUALITY = 0.85;
// ponytail: raw decode guard only; the sent image is capped by ASSISTANT_MAX_IMAGE_BYTES after downscaling
const MAX_RAW_IMAGE_BYTES = 25 * 1024 * 1024;

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });

const loadBitmap = (blob: Blob): Promise<ImageBitmap> => createImageBitmap(blob);

/** Draws onto a canvas and encodes it; PNG keeps transparency, JPEG is used when PNG is too large. */
function encodeCanvas(canvas: HTMLCanvasElement, preferPng: boolean): string {
  if (preferPng) {
    const png = canvas.toDataURL('image/png');
    if (decodedBase64Bytes(png.slice(png.indexOf(',') + 1)) <= ASSISTANT_MAX_IMAGE_BYTES) return png;
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * Converts an image to a size-limited data URL. Large images are downscaled so the longest side is at most
 * ASSISTANT_IMAGE_MAX_LONG_SIDE, which keeps token usage and request size reasonable.
 */
export async function prepareImageAttachment(file: File | Blob, name: string): Promise<AssistantAttachment> {
  if (!isAssistantImageMimeType(file.type)) throw new AttachmentReadFailure('imageUnsupported');
  // The raw file may be larger than the send limit: it is downscaled first and only the result must fit
  if (file.size > MAX_RAW_IMAGE_BYTES) throw new AttachmentReadFailure('imageTooLarge');
  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, ASSISTANT_IMAGE_MAX_LONG_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas is not available');
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = encodeCanvas(canvas, file.type === 'image/png' || file.type === 'image/webp');
    if (decodedBase64Bytes(dataUrl.slice(dataUrl.indexOf(',') + 1)) > ASSISTANT_MAX_IMAGE_BYTES) {
      throw new AttachmentReadFailure('imageTooLarge');
    }
    return { id: crypto.randomUUID(), name, mimeType: dataUrl.slice(5, dataUrl.indexOf(';')), kind: 'image', dataUrl };
  } finally {
    bitmap.close();
  }
}

/** Crops a PNG data URL to a pixel rect and returns the result as a PNG data URL. */
export async function cropImageDataUrl(dataUrl: string, rect: PixelRect): Promise<string> {
  const bitmap = await loadBitmap(await (await fetch(dataUrl)).blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.getContext('2d')?.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return encodeCanvas(canvas, true);
  } finally {
    bitmap.close();
  }
}

/** Reads a non-image file as a base64 data URL for upload_file. */
export async function prepareBinaryAttachment(file: File): Promise<AssistantAttachment> {
  if (file.size > ASSISTANT_MAX_FILE_BYTES) throw new AttachmentReadFailure('fileTooLarge');
  const dataUrl = await readAsDataUrl(file);
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';')) || 'application/octet-stream';
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType,
    kind: 'file',
    dataUrl: fixDataUrlType(dataUrl, mimeType),
  };
}

/** FileReader yields "data:;base64," for untyped files; give them the generic octet-stream type. */
function fixDataUrlType(dataUrl: string, mimeType: string): string {
  return dataUrl.startsWith('data:;') ? `data:${mimeType};${dataUrl.slice('data:;'.length)}` : dataUrl;
}

export const IMAGE_ACCEPT = ASSISTANT_IMAGE_MIME_TYPES.join(',');
