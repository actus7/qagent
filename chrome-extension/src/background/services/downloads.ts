import { createLogger } from '../log';
import {
  createDownloadWatch,
  settledDownload,
  watchOnChanged,
  watchOnCreated,
  type DownloadRecord,
  type DownloadWatch,
} from './download-logic';

const logger = createLogger('downloads');
const POLL_MS = 250;

// Armed captures, each holding its own watch. Downloads that start while a capture is armed are recorded in it.
const armed = new Set<{ watch: DownloadWatch }>();

export interface DownloadCapture {
  /** Resolves with the first download that finishes, or null when the timeout passes first. */
  wait(timeoutMs: number): Promise<DownloadRecord | null>;
  release(): void;
}

/**
 * onCreated can report the file name before Chrome has picked it, so the settled record is read back
 * from chrome.downloads, which has the final local path and state.
 */
async function finalDetails(record: DownloadRecord): Promise<DownloadRecord> {
  const [item] = await chrome.downloads.search({ id: record.id }).catch(() => []);
  if (!item) return record;
  return { ...record, filename: item.filename || record.filename, state: item.state };
}

/** Arms a capture. Call it before the click that starts the download. */
export function armDownloadCapture(now: number = Date.now()): DownloadCapture {
  const holder = { watch: createDownloadWatch(now) };
  armed.add(holder);
  return {
    async wait(timeoutMs: number): Promise<DownloadRecord | null> {
      const started = Date.now();
      for (;;) {
        const settled = settledDownload(holder.watch);
        if (settled) return finalDetails(settled);
        if (Date.now() - started >= timeoutMs) return null;
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
      }
    },
    release(): void {
      armed.delete(holder);
    },
  };
}

/** Registers the chrome.downloads listeners at top level in the worker. */
export function registerDownloadListeners(): void {
  chrome.downloads.onCreated.addListener(item => {
    for (const holder of armed) holder.watch = watchOnCreated(holder.watch, item);
  });
  chrome.downloads.onChanged.addListener(delta => {
    for (const holder of armed) holder.watch = watchOnChanged(holder.watch, delta);
  });
  logger.debug('download listeners registered');
}

export async function listRecentDownloads(limit: number): Promise<DownloadRecord[]> {
  const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit });
  return items.map(item => ({
    id: item.id,
    url: item.url,
    filename: item.filename,
    state: item.state,
    startedAt: Date.parse(item.startTime),
  }));
}

/**
 * True when `path` is a completed browser download. Upload-by-path is limited to these so a prompt
 * injection cannot make the agent attach arbitrary local files (keys, profiles) to a page.
 */
export async function isCompletedDownload(path: string): Promise<boolean> {
  const items = await chrome.downloads.search({ filename: path, state: 'complete' }).catch(() => []);
  return items.some(item => item.exists !== false && item.filename === path);
}
