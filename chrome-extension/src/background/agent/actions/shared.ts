import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import { createLogger } from '@src/background/log';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';

export const logger = createLogger('Action');

/** Emits the failure event and builds the result the model sees for an action that failed with `message`. */
export async function actionErrorResult(context: AgentContext, message: string): Promise<ActionResult> {
  await context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, message);
  return new ActionResult({ error: message, includeInMemory: true });
}

/** Result for inspection and pointer actions on an engine that does not provide them. */
export function engineUnsupportedResult(context: AgentContext): ActionResult {
  const msg = t('act_engineUnsupported');
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
  return new ActionResult({ error: msg, includeInMemory: true });
}

/** Cuts text to a limit so tool output cannot fill the context; the cut is marked for the model. */
export function clipText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
}

/** Failure result for an action whose page call threw. Page-thrown text can carry injected instructions, so the model gets it wrapped. */
export function actionFailedResult(context: AgentContext, error: unknown): ActionResult {
  const detail = error instanceof Error ? error.message : String(error);
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, t('act_failed', [detail]));
  return new ActionResult({ error: t('act_failed', [wrapUntrustedContent(detail)]), includeInMemory: true });
}

/** Failure result for an action given neither a ref/selector nor a readable target. */
export function missingLocatorResult(context: AgentContext): ActionResult {
  return actionFailedResult(context, new Error(t('act_needLocator')));
}
