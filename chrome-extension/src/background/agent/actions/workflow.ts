import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import { workflowsStore } from '@extension/storage';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { planWorkflowReplay } from '../../workflows/planner';
import { Action } from './action';
import { runWorkflowActionSchema } from './schemas';

/** Looks up a sibling action by name, so a workflow replays through the same actions the agent uses. */
export type ActionLookup = (name: string) => Action | undefined;

export function createRunWorkflowAction(context: AgentContext, lookup: ActionLookup) {
  return new Action(async (input: z.infer<typeof runWorkflowActionSchema.schema>) => {
    const intent = input.intent || t('act_runWorkflow_start', [input.name]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const fail = (msg: string) => {
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    };

    const workflow = await workflowsStore.findByRef(input.name);
    if (!workflow) return fail(t('act_runWorkflow_notFound', [input.name]));

    const plan = planWorkflowReplay(workflow, input.variables);
    if (!plan.ok) return fail(t('act_runWorkflow_invalid', [workflow.name, plan.error]));

    for (const [index, call] of plan.calls.entries()) {
      if (context.controller.signal.aborted) return fail(t('act_runWorkflow_stopped', [workflow.name]));
      const action = lookup(call.action);
      if (!action) return fail(t('act_runWorkflow_stepFail', [String(index + 1), call.label]));
      let result: ActionResult;
      try {
        result = await action.call(call.input);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return fail(t('act_runWorkflow_stepFail', [String(index + 1), `${call.label}: ${detail}`]));
      }
      if (result.error) return fail(t('act_runWorkflow_stepFail', [String(index + 1), call.label]));
    }

    const msg = t('act_runWorkflow_ok', [workflow.name, String(plan.calls.length)]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, runWorkflowActionSchema);
}
