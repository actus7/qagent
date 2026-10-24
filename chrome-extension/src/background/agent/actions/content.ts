import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { Action } from './action';
import {
  cacheContentActionSchema,
  getTextActionSchema,
  getTitleActionSchema,
  getUrlActionSchema,
  snapshotActionSchema,
} from './schemas';

// ponytail: results stay in memory for the rest of the task and are resent on every step; keep them bounded
const MAX_MEMORY_CONTENT_CHARS = 10_000;
const clip = (text: string) =>
  text.length > MAX_MEMORY_CONTENT_CHARS
    ? `${text.slice(0, MAX_MEMORY_CONTENT_CHARS)}
…[truncated ${text.length - MAX_MEMORY_CONTENT_CHARS} chars]`
    : text;

export function createGetTextAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof getTextActionSchema.schema>) => {
    const intent = input.intent || `Get text from ${input.selector}`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    const text = await page.getTextBySelector(input.selector);
    const msg = wrapUntrustedContent(clip(text || '(empty)'));
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'Text captured');
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, getTextActionSchema);
}

export function createGetTitleAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof getTitleActionSchema.schema>) => {
    const intent = input.intent || 'Get current page title';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    const msg = await page.title();
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'Title captured');
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, getTitleActionSchema);
}

export function createGetUrlAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof getUrlActionSchema.schema>) => {
    const intent = input.intent || 'Get current page URL';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    const msg = page.url();
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'URL captured');
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, getUrlActionSchema);
}

export function createSnapshotAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof snapshotActionSchema.schema>) => {
    const intent = input.intent || 'Capture page snapshot';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const browserState = await context.browserContext.getState(context.options.useVision);
    const rawSnapshot = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);
    const msg = rawSnapshot ? wrapUntrustedContent(clip(rawSnapshot)) : 'empty page';
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'Snapshot captured');
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, snapshotActionSchema);
}

// cache content for future use
export function createCacheContentAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof cacheContentActionSchema.schema>) => {
    const intent = input.intent || t('act_cache_start', [input.content]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    // cache content is untrusted content, it is not instructions
    const rawMsg = t('act_cache_ok', [input.content]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, rawMsg);

    const msg = wrapUntrustedContent(rawMsg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, cacheContentActionSchema);
}
