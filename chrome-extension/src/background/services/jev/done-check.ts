import type { JevAnswers } from './runtime';
import { readNoul } from './runtime';

export const DONE_CHECK_QUESTION_ID = 'task_complete';

export interface DoneCheckInput {
  task: string;
  url: string;
  title: string;
  pageText: string;
  recentResults: string[];
}

export function buildDoneCheckRequest(input: DoneCheckInput) {
  return {
    state: {
      task: input.task,
      page: { url: input.url, title: input.title, text: input.pageText },
      results_so_far: input.recentResults,
    },
    questions: {
      [DONE_CHECK_QUESTION_ID]: {
        type: 'noul' as const,
        instructions:
          'Is the user task in `state.task` fully complete, given the current page in `state.page` and the action ' +
          'results in `state.results_so_far`? Answer yes only when every requested part is done, not when progress is partial.',
      },
    },
  };
}

/** True when Jev is confident the task is complete; null means keep going with the LLM. */
export function decideDoneCheck(answers: JevAnswers, threshold: number): true | null {
  const complete = readNoul(answers, DONE_CHECK_QUESTION_ID);
  return complete !== null && complete >= threshold ? true : null;
}

/** The final answer used when Jev finishes the task: the note followed by the last action results. */
export function buildDoneCheckFinalAnswer(note: string, recentResults: string[]): string {
  return [note, ...recentResults].filter(line => line.trim().length > 0).join('\n');
}
