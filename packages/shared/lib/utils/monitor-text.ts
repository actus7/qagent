// Text normalization shared by the content-script watcher and the service worker, so both agree on "changed".

export const MONITOR_TEXT_MAX_CHARS = 2000;
const SNIPPET_CHARS = 160;

/** Collapses whitespace and caps the length. Two reads that normalize equal are the same content. */
export function normalizeMonitorText(text: string, maxChars = MONITOR_TEXT_MAX_CHARS): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

export function hasMonitorChanged(before: string, after: string): boolean {
  return normalizeMonitorText(before) !== normalizeMonitorText(after);
}

/** A short view of where two texts first differ, for the model and the notification. */
export function describeMonitorChange(before: string, after: string): string {
  const a = normalizeMonitorText(before);
  const b = normalizeMonitorText(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  const from = Math.max(0, start - 20);
  return b.slice(from, from + SNIPPET_CHARS);
}
