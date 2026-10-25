import {
  hasMonitorChanged,
  normalizeMonitorText,
  MONITOR_TEXT_MAX_CHARS,
} from '@extension/shared/lib/utils/monitor-text';

// Message names shared with the background service worker (chrome-extension/src/background/services/monitors.ts).
const START_MESSAGE = 'qagent:monitor:start';
const STOP_MESSAGE = 'qagent:monitor:stop';
const CHANGED_MESSAGE = 'qagent:monitor:changed';
// Mutations come in bursts (typing, animations); one read after the burst settles is enough.
const DEBOUNCE_MS = 500;

interface Watch {
  selector: string;
  last: string;
  observer: MutationObserver;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const watches = new Map<string, Watch>();

function readWatched(selector: string): string | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  return normalizeMonitorText((element as HTMLElement).innerText || element.textContent || '', MONITOR_TEXT_MAX_CHARS);
}

function stopWatch(id: string): void {
  const watch = watches.get(id);
  if (!watch) return;
  watch.observer.disconnect();
  clearTimeout(watch.timer);
  watches.delete(id);
}

function checkWatch(id: string): void {
  const watch = watches.get(id);
  if (!watch) return;
  const current = readWatched(watch.selector);
  // A removed element counts as a change too, reported as empty text.
  const next = current ?? '';
  if (!hasMonitorChanged(watch.last, next)) return;
  stopWatch(id);
  void chrome.runtime.sendMessage({ type: CHANGED_MESSAGE, id, text: next }).catch(() => undefined);
}

function startWatch(id: string, selector: string): void {
  stopWatch(id);
  const observer = new MutationObserver(() => {
    const watch = watches.get(id);
    if (!watch) return;
    clearTimeout(watch.timer);
    watch.timer = setTimeout(() => checkWatch(id), DEBOUNCE_MS);
  });
  const watch: Watch = { selector, last: readWatched(selector) ?? '', observer, timer: undefined };
  watches.set(id, watch);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
}

/** Watches for changes in the top document only. The observer dies with the page, and the background reports that. */
export function registerMonitorWatcher(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || window.top !== window) return false;
    const data = message as { type?: unknown; id?: unknown; selector?: unknown };
    if (typeof data?.id !== 'string') return false;
    if (data.type === START_MESSAGE && typeof data.selector === 'string') startWatch(data.id, data.selector);
    if (data.type === STOP_MESSAGE) stopWatch(data.id);
    return false;
  });
}
