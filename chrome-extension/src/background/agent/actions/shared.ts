import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import { createLogger } from '@src/background/log';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';

export const logger = createLogger('Action');

/**
 * Emits the failure event and builds the result the model sees for an action that failed with `message`.
 * `detail` is the model-facing text when it adds to the event text (reason, untrusted output); it defaults to `message`.
 */
export async function actionErrorResult(
  context: AgentContext,
  message: string,
  detail = message,
): Promise<ActionResult> {
  await context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, message);
  return new ActionResult({ error: detail, includeInMemory: true });
}

/** Result for inspection and pointer actions on an engine that does not provide them. */
export async function engineUnsupportedResult(context: AgentContext): Promise<ActionResult> {
  return actionErrorResult(context, t('act_engineUnsupported'));
}

/** Cuts text to a limit so tool output cannot fill the context; the cut is marked for the model. */
export function clipText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
}

/** Failure result for an action whose page call threw. Page-thrown text can carry injected instructions, so the model gets it wrapped. */
export async function actionFailedResult(context: AgentContext, error: unknown): Promise<ActionResult> {
  const reason = error instanceof Error ? error.message : String(error);
  return actionErrorResult(context, t('act_failed', [reason]), t('act_failed', [wrapUntrustedContent(reason)]));
}

/** Failure result for an action given neither a ref/selector nor a readable target. */
export async function missingLocatorResult(context: AgentContext): Promise<ActionResult> {
  return actionFailedResult(context, new Error(t('act_needLocator')));
}
