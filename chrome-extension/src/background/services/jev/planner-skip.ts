import type { JevAnswers } from './runtime';
import { readNoul } from './runtime';

export const PLANNER_SKIP_QUESTION_ID = 'single_direct_step';

export function buildPlannerSkipRequest(task: string) {
  return {
    state: { task },
    questions: {
      [PLANNER_SKIP_QUESTION_ID]: {
        type: 'noul' as const,
        instructions:
          'Is `state.task` a single, direct browser step (one navigation, click or fill, with no further planning ' +
          'needed)? Answer no for multi-step goals, checks, tests and reports.',
      },
    },
  };
}

/** True when Jev is confident the planner can be skipped; null keeps the planner. */
export function decidePlannerSkip(answers: JevAnswers, threshold: number): true | null {
  const single = readNoul(answers, PLANNER_SKIP_QUESTION_ID);
  return single !== null && single >= threshold ? true : null;
}
