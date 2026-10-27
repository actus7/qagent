import {
  isRecordedStep,
  MAX_RECORDED_STEPS,
  type RecordedStep,
  type WorkflowRecordingSnapshot,
} from '@extension/shared';

// Pure state machine for "Gravar fluxo": one recorded tab at a time. Chrome-specific work is injected through deps.
export interface WorkflowRecordingDeps {
  /** Reads the persisted snapshot (chrome.storage.session); may return anything, it is validated here. */
  load: () => Promise<unknown>;
  save: (snapshot: WorkflowRecordingSnapshot) => Promise<void>;
  clear: () => Promise<void>;
  /** Pushes the snapshot to the side panel. */
  publish: (snapshot: WorkflowRecordingSnapshot) => void;
  /** Arms (true) or disarms (false) capture in the tab's content script, including its recording indicator. */
  setCapture: (tabId: number, active: boolean) => void;
  isRecordableTab: (tabId: number) => Promise<boolean>;
}

export type StartRecordingResult = { ok: true } | { ok: false; reason: 'already_recording' | 'unsupported_tab' };

export interface WorkflowRecorder {
  snapshot: () => Promise<WorkflowRecordingSnapshot>;
  start: (tabId: number) => Promise<StartRecordingResult>;
  stop: () => Promise<boolean>;
  discard: () => Promise<void>;
  /** A step reported by a content script; only the recorded tab's sender is accepted. */
  appendStep: (senderTabId: number, step: unknown) => Promise<boolean>;
  /** Tab URL changed (full navigation or SPA route change). */
  navigated: (tabId: number, url: string) => Promise<void>;
  /** Re-arms capture after a page load, because a reloaded content script starts disarmed. */
  rearm: (tabId: number) => Promise<void>;
  tabClosed: (tabId: number) => Promise<void>;
}

export const IDLE_RECORDING: WorkflowRecordingSnapshot = { status: 'idle', tabId: null, steps: [], truncated: false };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Accepts only a well-formed persisted snapshot; anything else (tampered or old data) starts from idle. */
export function parseStoredRecording(value: unknown): WorkflowRecordingSnapshot {
  if (!isRecord(value)) return IDLE_RECORDING;
  const { status, tabId, steps, truncated } = value;
  if (status === 'idle') return IDLE_RECORDING;
  if ((status !== 'recording' && status !== 'stopped') || typeof tabId !== 'number') return IDLE_RECORDING;
  if (!Array.isArray(steps) || steps.length > MAX_RECORDED_STEPS || !steps.every(isRecordedStep)) return IDLE_RECORDING;
  return { status, tabId, steps, truncated: truncated === true };
}

export function createWorkflowRecorder(deps: WorkflowRecordingDeps): WorkflowRecorder {
  let current: WorkflowRecordingSnapshot = IDLE_RECORDING;
  // Every public method waits for the persisted state, so a message that arrives right after a worker restart is not lost.
  const ready = deps
    .load()
    .then(value => {
      current = parseStoredRecording(value);
    })
    .catch(() => undefined);

  // Functions rather than inline checks: TypeScript would otherwise narrow `current` across awaits.
  const isRecording = (): boolean => current.status === 'recording';
  const isRecordingTab = (tabId: number): boolean => isRecording() && current.tabId === tabId;

  const commit = (next: WorkflowRecordingSnapshot): void => {
    current = next;
    // Persistence is best effort: a failed write must not stop the live panel update.
    deps.save(next).catch(() => undefined);
    deps.publish(next);
  };

  const addStep = (step: RecordedStep): void => {
    if (current.steps.length >= MAX_RECORDED_STEPS) {
      if (!current.truncated) commit({ ...current, truncated: true });
      return;
    }
    commit({ ...current, steps: [...current.steps, step] });
  };

  const stopCurrent = (): boolean => {
    if (current.status !== 'recording' || current.tabId === null) return false;
    deps.setCapture(current.tabId, false);
    commit({ ...current, status: 'stopped' });
    return true;
  };

  return {
    async snapshot() {
      await ready;
      return current;
    },

    async start(tabId) {
      await ready;
      if (current.status === 'recording') return { ok: false, reason: 'already_recording' };
      if (!(await deps.isRecordableTab(tabId))) return { ok: false, reason: 'unsupported_tab' };
      // The tab check awaits, so another start may have won the race meanwhile.
      if (isRecording()) return { ok: false, reason: 'already_recording' };
      commit({ status: 'recording', tabId, steps: [], truncated: false });
      deps.setCapture(tabId, true);
      return { ok: true };
    },

    async stop() {
      await ready;
      return stopCurrent();
    },

    async discard() {
      await ready;
      if (current.status === 'recording' && current.tabId !== null) deps.setCapture(current.tabId, false);
      current = IDLE_RECORDING;
      deps.clear().catch(() => undefined);
      deps.publish(IDLE_RECORDING);
    },

    async appendStep(senderTabId, step) {
      await ready;
      // A disarmed content script flushes its pending step after stop, so the stopped tab still counts until discard
      const isRecordedTab = current.status !== 'idle' && current.tabId === senderTabId;
      if (!isRecordedTab || !isRecordedStep(step)) return false;
      addStep(step);
      return true;
    },

    async navigated(tabId, url) {
      await ready;
      if (!isRecordingTab(tabId)) return;
      const last = current.steps.at(-1);
      if (last?.kind === 'navigate' && last.url === url) return;
      const step: RecordedStep = { kind: 'navigate', url, at: Date.now() };
      if (isRecordedStep(step)) addStep(step);
    },

    async rearm(tabId) {
      await ready;
      if (isRecordingTab(tabId)) deps.setCapture(tabId, true);
    },

    async tabClosed(tabId) {
      await ready;
      if (isRecordingTab(tabId)) stopCurrent();
    },
  };
}
