import { describe, expect, it, vi } from 'vitest';
import { MAX_RECORDED_STEPS, type RecordedStep, type WorkflowRecordingSnapshot } from '@extension/shared';
import {
  createWorkflowRecorder,
  IDLE_RECORDING,
  parseStoredRecording,
  type WorkflowRecordingDeps,
} from '../services/workflowRecordingState';

const URL_A = 'https://app.test/login';
const clickStep: RecordedStep = {
  kind: 'click',
  url: URL_A,
  element: { role: 'button', name: 'Entrar', selector: '#go' },
  at: 1,
};

function setup(options: { stored?: unknown; recordable?: boolean } = {}) {
  let storage: unknown = options.stored;
  const published: WorkflowRecordingSnapshot[] = [];
  const deps = {
    load: vi.fn(async () => storage),
    save: vi.fn(async (snapshot: WorkflowRecordingSnapshot) => {
      storage = snapshot;
    }),
    clear: vi.fn(async () => {
      storage = undefined;
    }),
    publish: vi.fn((snapshot: WorkflowRecordingSnapshot) => {
      published.push(snapshot);
    }),
    setCapture: vi.fn(),
    isRecordableTab: vi.fn(async () => options.recordable ?? true),
  } satisfies WorkflowRecordingDeps;
  const recorder = createWorkflowRecorder(deps);
  return { recorder, deps, published, storage: () => storage };
}

describe('createWorkflowRecorder', () => {
  it('starts recording one tab, arms its content script and publishes the snapshot', async () => {
    const { recorder, deps, published } = setup();

    await expect(recorder.start(7)).resolves.toEqual({ ok: true });

    expect(deps.setCapture).toHaveBeenCalledWith(7, true);
    expect(published.at(-1)).toMatchObject({ status: 'recording', tabId: 7, steps: [] });
  });

  it('refuses a second start while recording and refuses pages that cannot be recorded', async () => {
    const first = setup();
    await first.recorder.start(1);
    await expect(first.recorder.start(2)).resolves.toEqual({ ok: false, reason: 'already_recording' });

    const unsupported = setup({ recordable: false });
    await expect(unsupported.recorder.start(3)).resolves.toEqual({ ok: false, reason: 'unsupported_tab' });
    expect((await unsupported.recorder.snapshot()).status).toBe('idle');
  });

  it('accepts steps only from the recorded tab and only when they validate', async () => {
    const { recorder } = setup();
    await recorder.start(7);

    expect(await recorder.appendStep(8, clickStep)).toBe(false);
    expect(await recorder.appendStep(7, { kind: 'eval', url: URL_A, at: 1 })).toBe(false);
    expect(await recorder.appendStep(7, clickStep)).toBe(true);
    expect((await recorder.snapshot()).steps).toEqual([clickStep]);
  });

  it('keeps the step the content script flushes after stop, until discard', async () => {
    const { recorder } = setup();
    await recorder.start(7);
    await recorder.stop();

    expect(await recorder.appendStep(8, clickStep)).toBe(false);
    expect(await recorder.appendStep(7, clickStep)).toBe(true);
    expect((await recorder.snapshot()).steps).toEqual([clickStep]);

    await recorder.discard();
    expect(await recorder.appendStep(7, clickStep)).toBe(false);
  });

  it('stops keeping steps when the cap is reached and marks the snapshot truncated', async () => {
    const { recorder } = setup();
    await recorder.start(7);
    for (let index = 0; index < MAX_RECORDED_STEPS + 5; index += 1) {
      await recorder.appendStep(7, { ...clickStep, at: index });
    }

    const snapshot = await recorder.snapshot();
    expect(snapshot.steps).toHaveLength(MAX_RECORDED_STEPS);
    expect(snapshot.truncated).toBe(true);
  });

  it('records a navigation once per URL and ignores navigations in other tabs', async () => {
    const { recorder } = setup();
    await recorder.start(7);

    await recorder.navigated(7, 'https://app.test/home');
    await recorder.navigated(7, 'https://app.test/home');
    await recorder.navigated(9, 'https://other.test/');

    const steps = (await recorder.snapshot()).steps;
    expect(steps.map(step => step.kind)).toEqual(['navigate']);
  });

  it('stops when the recorded tab closes but keeps the steps for review', async () => {
    const { recorder, deps } = setup();
    await recorder.start(7);
    await recorder.appendStep(7, clickStep);

    await recorder.tabClosed(7);

    const snapshot = await recorder.snapshot();
    expect(snapshot).toMatchObject({ status: 'stopped', tabId: 7 });
    expect(snapshot.steps).toHaveLength(1);
    expect(deps.setCapture).toHaveBeenLastCalledWith(7, false);
  });

  it('ignores the tab-closed event for other tabs', async () => {
    const { recorder } = setup();
    await recorder.start(7);

    await recorder.tabClosed(8);

    expect((await recorder.snapshot()).status).toBe('recording');
  });

  it('discard clears the steps and the persisted copy', async () => {
    const { recorder, deps, storage } = setup();
    await recorder.start(7);
    await recorder.appendStep(7, clickStep);

    await recorder.discard();

    expect(await recorder.snapshot()).toEqual(IDLE_RECORDING);
    expect(deps.clear).toHaveBeenCalled();
    expect(storage()).toBeUndefined();
  });

  it('persists every change so a restarted worker restores the recording', async () => {
    const first = setup();
    await first.recorder.start(7);
    await first.recorder.appendStep(7, clickStep);
    const persisted = first.storage();

    const restarted = setup({ stored: persisted });
    const snapshot = await restarted.recorder.snapshot();

    expect(snapshot).toMatchObject({ status: 'recording', tabId: 7 });
    expect(snapshot.steps).toEqual([clickStep]);
  });

  it('re-arms capture after a page load for the recorded tab only', async () => {
    const { recorder, deps } = setup();
    await recorder.start(7);
    deps.setCapture.mockClear();

    await recorder.rearm(7);
    await recorder.rearm(8);

    expect(deps.setCapture).toHaveBeenCalledTimes(1);
    expect(deps.setCapture).toHaveBeenCalledWith(7, true);
  });
});

describe('parseStoredRecording', () => {
  it('returns idle for missing, tampered or malformed data', () => {
    expect(parseStoredRecording(undefined)).toEqual(IDLE_RECORDING);
    expect(parseStoredRecording({ status: 'recording', tabId: 'x', steps: [] })).toEqual(IDLE_RECORDING);
    expect(
      parseStoredRecording({ status: 'recording', tabId: 1, steps: [{ kind: 'eval', url: URL_A, at: 1 }] }),
    ).toEqual(IDLE_RECORDING);
  });

  it('keeps a valid stopped snapshot', () => {
    const value = { status: 'stopped', tabId: 3, steps: [clickStep], truncated: false };

    expect(parseStoredRecording(value)).toEqual(value);
  });
});
