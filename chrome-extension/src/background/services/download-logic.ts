// Download watcher state. Pure: chrome.downloads events are folded in here, and the waiter reads the result.

export const DOWNLOAD_START_TOLERANCE_MS = 1000;

export interface DownloadRecord {
  id: number;
  url: string;
  filename: string;
  state: string;
  startedAt: number;
}

export interface DownloadWatch {
  armedAt: number;
  downloads: Record<number, DownloadRecord>;
}

export interface DownloadCreatedItem {
  id: number;
  url: string;
  filename: string;
  state: string;
  startTime: string;
}

export interface DownloadChangedDelta {
  id: number;
  state?: { current?: string };
  filename?: { current?: string };
}

export function createDownloadWatch(armedAt: number): DownloadWatch {
  return { armedAt, downloads: {} };
}

/** Tracks downloads that started after the watch was armed. Earlier ones belong to something else. */
export function watchOnCreated(watch: DownloadWatch, item: DownloadCreatedItem): DownloadWatch {
  const startedAt = Date.parse(item.startTime);
  if (!Number.isFinite(startedAt) || startedAt < watch.armedAt - DOWNLOAD_START_TOLERANCE_MS) return watch;
  return {
    ...watch,
    downloads: {
      ...watch.downloads,
      [item.id]: { id: item.id, url: item.url, filename: item.filename, state: item.state, startedAt },
    },
  };
}

export function watchOnChanged(watch: DownloadWatch, delta: DownloadChangedDelta): DownloadWatch {
  const known = watch.downloads[delta.id];
  if (!known) return watch;
  const updated: DownloadRecord = {
    ...known,
    state: delta.state?.current ?? known.state,
    filename: delta.filename?.current ?? known.filename,
  };
  return { ...watch, downloads: { ...watch.downloads, [delta.id]: updated } };
}

export function isSettled(state: string): boolean {
  return state === 'complete' || state === 'interrupted';
}

/** The first tracked download that finished, complete or interrupted. */
export function settledDownload(watch: DownloadWatch): DownloadRecord | null {
  return Object.values(watch.downloads).find(download => isSettled(download.state)) ?? null;
}
