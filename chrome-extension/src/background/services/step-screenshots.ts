// Step screenshots for the HTML session report. Kept in chrome.storage.session (cleared when the browser session
// ends), bounded per task and to the most recent tasks, and never written to the long-term chat history.
import { isSafeScreenshotDataUrl, type StepScreenshot } from '@extension/shared';

export const STEP_SCREENSHOT_STORAGE_KEY = 'qagent-step-screenshots';
export const MAX_SCREENSHOTS_PER_TASK = 20;
export const MAX_SCREENSHOT_TASKS = 3;
export const SCREENSHOT_MAX_WIDTH = 640;
const SCREENSHOT_JPEG_QUALITY = 0.7;
const BASE64_CHUNK_SIZE = 0x8000;

export interface TaskScreenshots {
  taskId: string;
  shots: StepScreenshot[];
}

export interface StepScreenshotStore {
  /** Oldest first; the last entry is the most recent task. */
  tasks: TaskScreenshots[];
}

const EMPTY_STORE: StepScreenshotStore = { tasks: [] };

/** True when the task can take one more screenshot. */
export function hasScreenshotRoom(store: StepScreenshotStore, taskId: string): boolean {
  const existing = store.tasks.find(task => task.taskId === taskId);
  return !existing || existing.shots.length < MAX_SCREENSHOTS_PER_TASK;
}

/** Returns a new store with the screenshot added, or the same store when the task is full. */
export function addStepScreenshot(
  store: StepScreenshotStore,
  taskId: string,
  shot: StepScreenshot,
): StepScreenshotStore {
  if (!hasScreenshotRoom(store, taskId)) return store;
  const exists = store.tasks.some(task => task.taskId === taskId);
  const tasks = exists
    ? store.tasks.map(task => (task.taskId === taskId ? { ...task, shots: [...task.shots, shot] } : task))
    : [...store.tasks, { taskId, shots: [shot] }];
  return { tasks: tasks.slice(-MAX_SCREENSHOT_TASKS) };
}

export function screenshotsForTask(store: StepScreenshotStore, taskId: string): StepScreenshot[] {
  return store.tasks.find(task => task.taskId === taskId)?.shots ?? [];
}

/** Reads the stored value defensively: anything unexpected is treated as an empty store. */
export function parseStepScreenshotStore(value: unknown): StepScreenshotStore {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { tasks?: unknown }).tasks)) {
    return EMPTY_STORE;
  }
  const tasks = (value as StepScreenshotStore).tasks.flatMap(task => {
    if (typeof task?.taskId !== 'string' || !Array.isArray(task.shots)) return [];
    const shots = task.shots.filter(shot => Number.isInteger(shot?.step) && isSafeScreenshotDataUrl(shot?.dataUrl));
    return [{ taskId: task.taskId, shots: shots.slice(0, MAX_SCREENSHOTS_PER_TASK) }];
  });
  return { tasks: tasks.slice(-MAX_SCREENSHOT_TASKS) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Scales a base64 JPEG down to SCREENSHOT_MAX_WIDTH and returns it as a JPEG data URL. */
export async function downscaleToJpegDataUrl(base64Jpeg: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64Jpeg), char => char.charCodeAt(0));
  const source = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  try {
    const width = Math.min(SCREENSHOT_MAX_WIDTH, source.width);
    const height = Math.max(1, Math.round((source.height * width) / source.width));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OffscreenCanvas 2D context unavailable');
    context.drawImage(source, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: SCREENSHOT_JPEG_QUALITY });
    return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } finally {
    source.close();
  }
}

async function readStore(): Promise<StepScreenshotStore> {
  const stored = await chrome.storage.session.get(STEP_SCREENSHOT_STORAGE_KEY);
  return parseStepScreenshotStore(stored[STEP_SCREENSHOT_STORAGE_KEY]);
}

// Captures arrive from the navigator while downscaling takes time; a queue keeps the read-modify-write ordered.
let writeQueue: Promise<void> = Promise.resolve();

async function storeScreenshot(taskId: string, step: number, base64Jpeg: string): Promise<void> {
  const store = await readStore();
  if (!hasScreenshotRoom(store, taskId)) return;
  const dataUrl = await downscaleToJpegDataUrl(base64Jpeg);
  if (!isSafeScreenshotDataUrl(dataUrl)) return;
  const next = addStepScreenshot(store, taskId, { step, dataUrl });
  await chrome.storage.session.set({ [STEP_SCREENSHOT_STORAGE_KEY]: next });
}

/** Stores the navigator's screenshot for a step. Rejects when the screenshot cannot be processed. */
export function recordStepScreenshot(taskId: string, step: number, base64Jpeg: string): Promise<void> {
  const write = writeQueue.then(() => storeScreenshot(taskId, step, base64Jpeg));
  writeQueue = write.catch(() => undefined);
  return write;
}

export async function readStepScreenshots(taskId: string): Promise<StepScreenshot[]> {
  return screenshotsForTask(await readStore(), taskId);
}
