import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import {
  backActionSchema,
  forwardActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  openActionSchema,
  reloadActionSchema,
  searchGoogleActionSchema,
  waitActionSchema,
} from './schemas';

async function navigateToUrl(context: AgentContext, intent: string, url: string): Promise<ActionResult> {
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
  await context.browserContext.navigateTo(url);
  const msg = t('act_goToUrl_ok', [url]);
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
  return new ActionResult({
    extractedContent: msg,
    includeInMemory: true,
  });
}

async function navigateBack(context: AgentContext, intent: string): Promise<ActionResult> {
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
  const page = await context.browserContext.getCurrentPage();
  await page.goBack();
  const msg = t('act_goBack_ok');
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
  return new ActionResult({
    extractedContent: msg,
    includeInMemory: true,
  });
}

export function createSearchGoogleAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof searchGoogleActionSchema.schema>) => {
    const intent = input.intent || t('act_searchGoogle_start', [input.query]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await context.browserContext.navigateTo(`https://www.google.com/search?q=${encodeURIComponent(input.query)}`);

    const msg2 = t('act_searchGoogle_ok', [input.query]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      // Mark this as a completion checkpoint so the executor can trigger a planner validation
      // on the next cycle instead of continuing blind navigation loops.
      isDone: true,
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchGoogleActionSchema);
}

export function createOpenAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof openActionSchema.schema>) => {
    const intent = input.intent || t('act_goToUrl_start', [input.url]);
    return navigateToUrl(context, intent, input.url);
  }, openActionSchema);
}

// Legacy alias kept for compatibility with older histories/prompts.
export function createGoToUrlAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof goToUrlActionSchema.schema>) => {
    const intent = input.intent || t('act_goToUrl_start', [input.url]);
    return navigateToUrl(context, intent, input.url);
  }, goToUrlActionSchema);
}

export function createBackAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof backActionSchema.schema>) => {
    const intent = input.intent || t('act_goBack_start');
    return navigateBack(context, intent);
  }, backActionSchema);
}

// Legacy alias kept for compatibility with older histories/prompts.
export function createGoBackAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof goBackActionSchema.schema>) => {
    const intent = input.intent || t('act_goBack_start');
    return navigateBack(context, intent);
  }, goBackActionSchema);
}

export function createForwardAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof forwardActionSchema.schema>) => {
    const intent = input.intent || 'Navigate forward';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    await page.goForward();
    const msg = 'Navigated forward';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, forwardActionSchema);
}

export function createReloadAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof reloadActionSchema.schema>) => {
    const intent = input.intent || 'Reload current page';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    await page.refreshPage();
    const msg = 'Page reloaded';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, reloadActionSchema);
}

export function createWaitAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof waitActionSchema.schema>) => {
    const seconds = input.seconds || 3;
    const intent = input.intent || t('act_wait_start', [seconds.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    const msg = t('act_wait_ok', [seconds.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, waitActionSchema);
}
