import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { formatPageInfo } from '../../browser/page-info';
import { formatProgressReport, rankProgressSignals } from '../../browser/progress';
import { describeTargetSpec, type TargetSpec } from '../../browser/target-resolver';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { Action } from './action';
import { actionFailedResult, engineUnsupportedResult, missingLocatorResult } from './shared';
import {
  findProgressActionSchema,
  handleDialogActionSchema,
  readAccessibilityTreeActionSchema,
  pageInfoActionSchema,
  switchFrameActionSchema,
  waitForElementActionSchema,
} from './schemas';

const REF_PATTERN = /^@e\d+$/i;

export function createPageInfoAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof pageInfoActionSchema.schema>) => {
    const intent = input.intent || t('act_pageInfo_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.getPageFacts) return engineUnsupportedResult(context);
    try {
      const facts = await page.getPageFacts({ maxPerKind: input.max_per_kind, geometry: input.geometry });
      const msg = t('act_pageInfo_ok');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      const text = formatPageInfo(facts, { maxPerKind: input.max_per_kind, geometry: input.geometry });
      // Site tools are only counted here; list_site_tools gives their names and schemas.
      const site = page.listSiteTools ? await page.listSiteTools().catch(() => null) : null;
      const siteNote =
        site && site.tools.length > 0 ? `\nSite tools (WebMCP): ${site.tools.length}; see list_site_tools` : '';
      return new ActionResult({ extractedContent: wrapUntrustedContent(text + siteNote), includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, pageInfoActionSchema);
}

export function createFindProgressAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof findProgressActionSchema.schema>) => {
    const intent = input.intent || t('act_progress_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.findProgressSignals) return engineUnsupportedResult(context);
    try {
      const report = await page.findProgressSignals();
      const text = formatProgressReport({ ...report, signals: rankProgressSignals(report.signals) });
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, t('act_progress_ok'));
      return new ActionResult({ extractedContent: wrapUntrustedContent(text), includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, findProgressActionSchema);
}

export function createWaitForElementAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof waitForElementActionSchema.schema>) => {
    // Refs come from one snapshot and go stale on any change, so a wait needs a CSS selector or a target.
    if (input.selector && REF_PATTERN.test(input.selector.trim())) {
      return actionFailedResult(context, new Error('wait_for_element needs a CSS selector or a target, not a @e ref'));
    }
    const spec: TargetSpec | null = input.target ?? (input.selector ? { selector: input.selector } : null);
    if (!spec) return missingLocatorResult(context);
    const label = describeTargetSpec(spec);
    const intent = input.intent || t('act_waitFor_start', [label, input.state]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.waitForTarget) return engineUnsupportedResult(context);
    try {
      const elapsed = await page.waitForTarget(spec, input.state, input.timeout_ms);
      const msg = t('act_waitFor_ok', [label, input.state, String(elapsed)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, waitForElementActionSchema);
}

export function createSwitchFrameAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof switchFrameActionSchema.schema>) => {
    const page = await context.browserContext.getCurrentPage();
    if (!page.listFrames || !page.focusFrame) return engineUnsupportedResult(context);
    try {
      if (input.index === undefined) {
        const frames = await page.listFrames();
        const lines = frames.map(
          frame =>
            `${frame.index}: ${frame.url}${frame.name ? ` name=${frame.name}` : ''}${frame.crossOrigin ? ' cross-origin' : ''}${frame.focused ? ' (in scope)' : ''}`,
        );
        return new ActionResult({ extractedContent: wrapUntrustedContent(lines.join('\n')), includeInMemory: true });
      }
      const intent = input.intent || t('act_switchFrame_start', [String(input.index)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const frame = await page.focusFrame(input.index);
      const msg = t('act_switchFrame_ok', [String(frame.index), wrapUntrustedContent(frame.url)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, switchFrameActionSchema);
}

export function createHandleDialogAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof handleDialogActionSchema.schema>) => {
    const page = await context.browserContext.getCurrentPage();
    if (!page.setNextDialogResponse) return engineUnsupportedResult(context);
    await page.setNextDialogResponse({ accept: input.accept, promptText: input.prompt_text });
    const msg = t('act_handleDialog_ok', [input.accept ? 'OK' : 'Cancel']);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.intent || msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, handleDialogActionSchema);
}

export function createReadAccessibilityTreeAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof readAccessibilityTreeActionSchema.schema>) => {
    const intent = input.intent || t('act_readAccessibilityTree_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.getAccessibilityTree) return engineUnsupportedResult(context);
    try {
      const tree = await page.getAccessibilityTree(input.max_nodes);
      const msg = t('act_readAccessibilityTree_ok');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      // names and values come from the page
      return new ActionResult({ extractedContent: wrapUntrustedContent(tree), includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, readAccessibilityTreeActionSchema);
}
