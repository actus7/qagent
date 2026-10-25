import { ActionResult, type AgentContext } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { askUserActionSchema } from './schemas';

/**
 * Shows the question in the side panel and holds the task until the user answers (or stops it).
 * The answer is the action result, so the next step sees it as plain user text.
 */
export function createAskUserAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof askUserActionSchema.schema>) => {
    const options = input.options ?? [];
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, input.question, undefined, {
      question: input.question,
      options,
    });
    const answer = await context.waitForUserAnswer();
    if (answer === '') {
      return new ActionResult({
        extractedContent: 'The user did not answer because the task was stopped.',
        includeInMemory: true,
      });
    }
    return new ActionResult({ extractedContent: `User answered: ${answer}`, includeInMemory: true });
  }, askUserActionSchema);
}
