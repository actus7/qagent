import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { closeTabActionSchema, openTabActionSchema, switchTabActionSchema } from './schemas';

export function createSwitchTabAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof switchTabActionSchema.schema>) => {
    const intent = input.intent || t('act_switchTab_start', [input.tab_id.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    await context.browserContext.switchTab(input.tab_id);
    const msg = t('act_switchTab_ok', [input.tab_id.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, switchTabActionSchema);
}

export function createOpenTabAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof openTabActionSchema.schema>) => {
    const intent = input.intent || t('act_openTab_start', [input.url]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    await context.browserContext.openTab(input.url);
    const msg = t('act_openTab_ok', [input.url]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, openTabActionSchema);
}

export function createCloseTabAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof closeTabActionSchema.schema>) => {
    const intent = input.intent || t('act_closeTab_start', [input.tab_id.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    await context.browserContext.closeTab(input.tab_id);
    const msg = t('act_closeTab_ok', [input.tab_id.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, closeTabActionSchema);
}
