// "Ask QAgent about this" context handed from the background (context menu) to the side panel.

export const CONTEXT_PREFILL_STORAGE_KEY = 'qagent:context-prefill';
// A prefill that nobody picks up within this window is dropped instead of surprising a later panel session.
export const CONTEXT_PREFILL_TTL_MS = 60_000;

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 500;
export const MAX_SELECTION_LENGTH = 4000;
const HTTP_URL_PATTERN = /^https?:\/\//i;

export interface ContextPrefillPayload {
  tabId: number;
  pageUrl: string;
  pageTitle: string;
  selectionText?: string;
  linkUrl?: string;
  imageUrl?: string;
}

export interface StoredContextPrefill {
  payload: ContextPrefillPayload;
  createdAt: number;
}

export interface ContextPrefillLabels {
  page: string;
  link: string;
  image: string;
  selection: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_URL_LENGTH && HTTP_URL_PATTERN.test(value);
}

function isOptional(value: unknown, check: (candidate: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

/** Shape check for a prefill. Background and panel both call it, so neither trusts the other's data. */
export function isContextPrefillPayload(value: unknown): value is ContextPrefillPayload {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.tabId) &&
    (value.tabId as number) >= 0 &&
    typeof value.pageUrl === 'string' &&
    value.pageUrl.length <= MAX_URL_LENGTH &&
    typeof value.pageTitle === 'string' &&
    value.pageTitle.length <= MAX_TITLE_LENGTH &&
    isOptional(value.selectionText, text => typeof text === 'string' && text.length <= MAX_SELECTION_LENGTH) &&
    isOptional(value.linkUrl, isHttpUrl) &&
    isOptional(value.imageUrl, isHttpUrl)
  );
}

/** Reads a value from chrome.storage.session; returns null when it is missing, stale or malformed. */
export function readStoredContextPrefill(value: unknown, now: number): ContextPrefillPayload | null {
  if (!isRecord(value) || typeof value.createdAt !== 'number') return null;
  if (now - value.createdAt > CONTEXT_PREFILL_TTL_MS || now < value.createdAt) return null;
  return isContextPrefillPayload(value.payload) ? value.payload : null;
}

/** Composer text: the selection as a quote, followed by the page, link and image references. */
export function formatContextPrefill(payload: ContextPrefillPayload, labels: ContextPrefillLabels): string {
  const lines: string[] = [];
  if (payload.selectionText?.trim()) {
    const quoted = payload.selectionText
      .trim()
      .split('\n')
      .map(line => `> ${line}`);
    lines.push(`${labels.selection}:`, ...quoted, '');
  }
  lines.push(`${labels.page}: ${payload.pageTitle || payload.pageUrl} (${payload.pageUrl})`);
  if (payload.linkUrl) lines.push(`${labels.link}: ${payload.linkUrl}`);
  if (payload.imageUrl) lines.push(`${labels.image}: ${payload.imageUrl}`);
  return lines.join('\n') + '\n\n';
}
