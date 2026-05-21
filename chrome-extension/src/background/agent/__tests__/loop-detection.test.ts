import { describe, expect, it } from 'vitest';
import type { AgentStepRecord } from '../history';
import { createLoopDetectionState, evaluateLoopDetection } from '../loop-detection';

function makeStep(action: Record<string, unknown>, url = 'https://www.google.com/search?q=carros') {
  return {
    modelOutput: JSON.stringify({
      action: [action],
    }),
    state: {
      url,
    },
  } as AgentStepRecord;
}

describe('evaluateLoopDetection', () => {
  it('detects repeated loop-prone signature', () => {
    const step = makeStep({ search_google: { query: 'carros mais vendidos 2025' } });
    let state = createLoopDetectionState();

    let evaluation = evaluateLoopDetection(state, step, false);
    expect(evaluation.loopDetected).toBe(false);
    state = evaluation.nextState;

    evaluation = evaluateLoopDetection(state, step, false);
    expect(evaluation.loopDetected).toBe(false);
    state = evaluation.nextState;

    evaluation = evaluateLoopDetection(state, step, false);
    expect(evaluation.loopDetected).toBe(true);
  });

  it('does not flag when the step includes non loop-prone action', () => {
    const step = makeStep({ click_element: { index: 2 } });
    const evaluation = evaluateLoopDetection(createLoopDetectionState(), step, false);

    expect(evaluation.loopDetected).toBe(false);
    expect(evaluation.nextState.navigationOnlyStreak).toBe(0);
    expect(evaluation.nextState.signatures).toEqual([]);
  });

  it('detects long navigation-only streak even with different signatures', () => {
    let state = createLoopDetectionState();
    let loopDetected = false;

    for (let i = 0; i < 6; i++) {
      const step = makeStep({ go_to_url: { url: `https://example.com/page-${i}` } }, 'https://example.com');
      const evaluation = evaluateLoopDetection(state, step, false);
      state = evaluation.nextState;
      loopDetected = evaluation.loopDetected;
    }

    expect(loopDetected).toBe(true);
  });

  it('tracks open action as loop-prone navigation', () => {
    const step = makeStep({ open: { url: 'https://example.com/dashboard' } }, 'https://example.com');
    let state = createLoopDetectionState();

    state = evaluateLoopDetection(state, step, false).nextState;
    state = evaluateLoopDetection(state, step, false).nextState;
    const evaluation = evaluateLoopDetection(state, step, false);

    expect(evaluation.loopDetected).toBe(true);
  });

  it('resets tracking when navigator marks step as done', () => {
    const step = makeStep({ search_google: { query: 'carros' } });
    let state = createLoopDetectionState();

    state = evaluateLoopDetection(state, step, false).nextState;
    const evaluation = evaluateLoopDetection(state, step, true);

    expect(evaluation.loopDetected).toBe(false);
    expect(evaluation.nextState.navigationOnlyStreak).toBe(0);
    expect(evaluation.nextState.signatures).toEqual([]);
  });

  it('fails open when model output is invalid json', () => {
    const step = {
      modelOutput: '{ invalid json',
      state: { url: 'https://www.google.com' },
    } as AgentStepRecord;

    const evaluation = evaluateLoopDetection(createLoopDetectionState(), step, false);

    expect(evaluation.loopDetected).toBe(false);
    expect(evaluation.nextState.navigationOnlyStreak).toBe(0);
    expect(evaluation.nextState.signatures).toEqual([]);
  });
});
