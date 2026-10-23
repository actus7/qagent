import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_MAX_FILE_BYTES,
  ASSISTANT_MAX_IMAGE_BYTES,
  getAssistantAttachmentError,
  isSidePanelCommandMessage,
  type AssistantAttachment,
} from '@extension/shared';
import {
  buildFileAttachmentNote,
  buildImageContentParts,
  buildUserContent,
  indexFileAttachments,
} from '../assistant-attachments';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`;

const image = (overrides: Partial<AssistantAttachment> = {}): AssistantAttachment => ({
  id: 'img-1',
  name: 'shot.png',
  mimeType: 'image/png',
  kind: 'image',
  dataUrl: PNG_DATA_URL,
  ...overrides,
});

const file = (overrides: Partial<AssistantAttachment> = {}): AssistantAttachment => ({
  id: 'file-1',
  name: 'notes.pdf',
  mimeType: 'application/pdf',
  kind: 'file',
  dataUrl: PDF_DATA_URL,
  ...overrides,
});

/** A base64 data URL whose decoded payload is exactly `bytes` long (bytes must be a multiple of 3). */
const dataUrlOfBytes = (mimeType: string, bytes: number) => `data:${mimeType};base64,${'A'.repeat((bytes / 3) * 4)}`;

describe('attachment validation', () => {
  it('accepts a valid image and a valid binary file', () => {
    expect(getAssistantAttachmentError([image(), file()])).toBeNull();
  });

  it('rejects more than five images', () => {
    const images = Array.from({ length: 6 }, (_, index) => image({ id: `i${index}`, name: `i${index}.png` }));
    expect(getAssistantAttachmentError(images)).toMatch(/at most 5 images/);
  });

  it('rejects an image larger than the 5 MB limit after decoding', () => {
    const big = image({ dataUrl: dataUrlOfBytes('image/png', ASSISTANT_MAX_IMAGE_BYTES + 3) });
    expect(getAssistantAttachmentError([big])).toMatch(/larger than 5 MB/);
  });

  it('rejects a binary file larger than 10 MB', () => {
    const big = file({ dataUrl: dataUrlOfBytes('application/pdf', ASSISTANT_MAX_FILE_BYTES + 3) });
    expect(getAssistantAttachmentError([big])).toMatch(/larger than 10 MB/);
  });

  it('rejects a MIME type that does not match the data URL', () => {
    expect(getAssistantAttachmentError([image({ mimeType: 'image/jpeg' })])).toMatch(/mime type/);
  });

  it('rejects an unsupported image type', () => {
    const svg = image({ mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(getAssistantAttachmentError([svg])).toMatch(/unsupported image type/);
  });

  it('rejects names with path separators and non data URL payloads', () => {
    expect(getAssistantAttachmentError([file({ name: '../secret.pdf' })])).toMatch(/path separators/);
    expect(getAssistantAttachmentError([file({ dataUrl: 'https://example.com/a.pdf' })])).toMatch(/base64 data URL/);
  });

  it('is enforced by the port message guard for new tasks', () => {
    const base = { type: 'new_task', task: 'Upload', taskId: 't1', tabId: 1, options: { mode: 'act' } };
    expect(isSidePanelCommandMessage({ ...base, attachments: [file()] })).toBe(true);
    expect(isSidePanelCommandMessage({ ...base, attachments: [file({ name: 'a/b.pdf' })] })).toBe(false);
    expect(isSidePanelCommandMessage({ ...base, attachments: 'nope' })).toBe(false);
  });

  it('allows an attachment-only task with an empty text', () => {
    const message = { type: 'new_task', task: '', taskId: 't1', tabId: 1, attachments: [image()] };
    expect(isSidePanelCommandMessage(message)).toBe(true);
    expect(isSidePanelCommandMessage({ ...message, attachments: [] })).toBe(false);
  });
});

describe('model content', () => {
  it('builds image_url parts only from image attachments', () => {
    expect(buildImageContentParts([image(), file()])).toEqual([
      { type: 'image_url', image_url: { url: PNG_DATA_URL } },
    ]);
  });

  it('keeps plain text when there are no images', () => {
    expect(buildUserContent('hello', [file()])).toBe('hello');
    expect(buildUserContent('hello')).toBe('hello');
  });

  it('puts the text first and the images after it', () => {
    expect(buildUserContent('what is this?', [image()])).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: PNG_DATA_URL } },
    ]);
  });

  it('omits the text part when the task text is blank', () => {
    expect(buildUserContent('  ', [image()])).toEqual([{ type: 'image_url', image_url: { url: PNG_DATA_URL } }]);
  });
});

describe('binary attachments for upload_file', () => {
  it('indexes binary files by name with their MIME type and base64 payload', () => {
    const index = indexFileAttachments([image(), file()]);
    expect(index.size).toBe(1);
    expect(index.get('notes.pdf')).toEqual({
      mimeType: 'application/pdf',
      base64: Buffer.from('%PDF-1.4').toString('base64'),
    });
  });

  it('lists the attached file names for the navigator task context', () => {
    expect(buildFileAttachmentNote([image()])).toBe('');
    const note = buildFileAttachmentNote([file()]);
    expect(note).toContain('- notes.pdf (application/pdf)');
    expect(note).toContain('"attachment"');
  });
});
