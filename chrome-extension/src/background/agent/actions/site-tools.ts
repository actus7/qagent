import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { formatSiteTools } from '../../browser/site-tools';
import { Action } from './action';
import { actionFailedResult, engineUnsupportedResult } from './shared';
import { callSiteToolActionSchema, listSiteToolsActionSchema } from './schemas';

const SITE_TOOL_TIMEOUT_MS = 15000;

export function createListSiteToolsAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof listSiteToolsActionSchema.schema>) => {
    const intent = input.intent || t('act_siteTools_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.listSiteTools) return engineUnsupportedResult(context);
    try {
      const { api, tools } = await page.listSiteTools();
      if (tools.length === 0) {
        const msg = t('act_siteTools_none');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      const msg = t('act_siteTools_ok', [String(tools.length), api ?? '']);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({
        extractedContent: `${msg}\n${wrapUntrustedContent(formatSiteTools(tools))}`,
        includeInMemory: true,
      });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, listSiteToolsActionSchema);
}

export function createCallSiteToolAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof callSiteToolActionSchema.schema>) => {
    const intent = input.intent || t('act_siteToolCall_start', [input.name]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.callSiteTool) return engineUnsupportedResult(context);
    try {
      const json = await page.callSiteTool(input.name, input.args, SITE_TOOL_TIMEOUT_MS);
      const msg = t('act_siteToolCall_ok', [input.name]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: `${msg}\n${wrapUntrustedContent(json)}`, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, callSiteToolActionSchema);
}
