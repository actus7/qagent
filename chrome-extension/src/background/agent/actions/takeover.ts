import { t } from '@extension/i18n';
import { ActionResult, type AgentContext } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { requestUserTakeoverActionSchema, type USER_TAKEOVER_REASONS } from './schemas';

type TakeoverReason = (typeof USER_TAKEOVER_REASONS)[number];

const REASON_LABEL_KEYS = {
  authentication: 'act_requestUserTakeover_reason_authentication',
  captcha: 'act_requestUserTakeover_reason_captcha',
  two_factor: 'act_requestUserTakeover_reason_two_factor',
  payment: 'act_requestUserTakeover_reason_payment',
  user_requested: 'act_requestUserTakeover_reason_user_requested',
  other: 'act_requestUserTakeover_reason_other',
} as const satisfies Record<TakeoverReason, string>;

/**
 * Pauses the task through the normal pause path; the executor holds until the user resumes it.
 * Changes nothing on the page, so it needs no approval.
 */
export function createRequestUserTakeoverAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof requestUserTakeoverActionSchema.schema>) => {
    const reasonLabel = t(REASON_LABEL_KEYS[input.reason]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_requestUserTakeover_start', [reasonLabel]));
    await context.pause();
    await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_PAUSE, input.message, {
      reason: input.reason,
      reasonLabel,
      message: input.message,
    });
    return new ActionResult({
      extractedContent: `Paused for the user (${input.reason}). The task resumes when the user hands control back; the page is re-read before the next step.`,
      includeInMemory: true,
    });
  }, requestUserTakeoverActionSchema);
}
