import { ActionResult, type AgentContext } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { doneActionSchema } from './schemas';

export function createDoneAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof doneActionSchema.schema>) => {
    context.finalAnswer = input.text;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.text);
    return new ActionResult({
      isDone: true,
      extractedContent: input.text,
    });
  }, doneActionSchema);
}
