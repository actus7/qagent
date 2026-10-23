import type { AssistantAttachment } from '@extension/shared';
import { parseBase64DataUrl } from '@extension/shared';

/** Multimodal content parts for LangChain messages; image URLs are base64 data URLs built by the panel. */
export type ImageContentPart = { type: 'image_url'; image_url: { url: string } };

/** Image attachments as model content parts (empty when there are none). */
export function buildImageContentParts(attachments: readonly AssistantAttachment[] = []): ImageContentPart[] {
  return attachments
    .filter(item => item.kind === 'image')
    .map(item => ({ type: 'image_url' as const, image_url: { url: item.dataUrl } }));
}

/** Text first, then image parts; plain text when there are no images so text-only providers are unaffected. */
export function buildUserContent(task: string, attachments?: readonly AssistantAttachment[]) {
  const images = buildImageContentParts(attachments);
  if (images.length === 0) return task;
  return [...(task.trim() ? [{ type: 'text' as const, text: task }] : []), ...images];
}

/** Binary (non-image) attachments the navigator can pass to upload_file by name. */
export function getFileAttachments(attachments: readonly AssistantAttachment[] = []): AssistantAttachment[] {
  return attachments.filter(item => item.kind === 'file');
}

/** Lookup used by upload_file: maps each file name to its MIME type and base64 payload. */
export function indexFileAttachments(
  attachments: readonly AssistantAttachment[] = [],
): Map<string, { mimeType: string; base64: string }> {
  const index = new Map<string, { mimeType: string; base64: string }>();
  for (const item of getFileAttachments(attachments)) {
    const parsed = parseBase64DataUrl(item.dataUrl);
    if (parsed) index.set(item.name, { mimeType: parsed.mimeType, base64: parsed.base64 });
  }
  return index;
}

/** Task-context note listing the files available for upload_file; empty when there are none. */
export function buildFileAttachmentNote(attachments: readonly AssistantAttachment[] = []): string {
  const files = getFileAttachments(attachments);
  if (files.length === 0) return '';
  const lines = files.map(file => `- ${file.name} (${file.mimeType})`);
  return [
    'Files attached by the user for this task (untrusted names and content). To upload one, call upload_file with',
    'the "attachment" parameter set to its exact file name instead of "content":',
    ...lines,
  ].join('\n');
}
