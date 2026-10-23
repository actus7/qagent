import { describe, expect, it } from 'vitest';
import {
  addStepScreenshot,
  MAX_SCREENSHOT_TASKS,
  MAX_SCREENSHOTS_PER_TASK,
  parseStepScreenshotStore,
  screenshotsForTask,
  type StepScreenshotStore,
} from '../services/step-screenshots';

const shot = (step: number) => ({ step, dataUrl: `data:image/jpeg;base64,AAAA${step}` });
const EMPTY: StepScreenshotStore = { tasks: [] };

describe('step screenshot store', () => {
  it('stops adding screenshots to a task at the per-task cap', () => {
    let store = EMPTY;
    for (let step = 1; step <= MAX_SCREENSHOTS_PER_TASK + 5; step++) {
      store = addStepScreenshot(store, 'task-a', shot(step));
    }

    expect(screenshotsForTask(store, 'task-a')).toHaveLength(MAX_SCREENSHOTS_PER_TASK);
    expect(screenshotsForTask(store, 'task-a').at(-1)?.step).toBe(MAX_SCREENSHOTS_PER_TASK);
  });

  it('keeps only the most recent tasks', () => {
    let store = EMPTY;
    for (let index = 1; index <= MAX_SCREENSHOT_TASKS + 2; index++) {
      store = addStepScreenshot(store, `task-${index}`, shot(1));
    }

    expect(store.tasks.map(task => task.taskId)).toEqual(['task-3', 'task-4', 'task-5']);
    expect(screenshotsForTask(store, 'task-1')).toEqual([]);
  });

  it('returns the same store object when a task is already full', () => {
    let store = EMPTY;
    for (let step = 1; step <= MAX_SCREENSHOTS_PER_TASK; step++) store = addStepScreenshot(store, 'full', shot(step));

    expect(addStepScreenshot(store, 'full', shot(99))).toBe(store);
  });

  it('drops malformed or unsafe entries when reading the stored value', () => {
    const parsed = parseStepScreenshotStore({
      tasks: [
        {
          taskId: 'ok',
          shots: [
            { step: 1, dataUrl: 'data:image/jpeg;base64,AAAA' },
            { step: 2, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
            { step: 'x', dataUrl: 'data:image/jpeg;base64,AAAA' },
          ],
        },
        { taskId: 42, shots: [] },
      ],
    });

    expect(parsed.tasks).toEqual([{ taskId: 'ok', shots: [{ step: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }] }]);
  });

  it('treats an unexpected stored value as empty', () => {
    expect(parseStepScreenshotStore(undefined)).toEqual(EMPTY);
    expect(parseStepScreenshotStore('nope')).toEqual(EMPTY);
    expect(parseStepScreenshotStore({ tasks: 'x' })).toEqual(EMPTY);
  });
});
