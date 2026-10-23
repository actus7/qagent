import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import {
  formatConsoleEntries,
  formatNetworkEntries,
  type ConsoleReadOptions,
  type NetworkReadOptions,
} from '../../browser/page-telemetry';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { Action } from './action';
import { engineUnsupportedResult } from './shared';
import {
  executeJavascriptActionSchema,
  readConsoleMessagesActionSchema,
  readNetworkRequestsActionSchema,
  resizeViewportActionSchema,
} from './schemas';

// Optional schema fields arrive as null or undefined; the buffer readers treat both as "no filter".
function toConsoleOptions(input: z.infer<typeof readConsoleMessagesActionSchema.schema>): ConsoleReadOptions {
  return {
    level: input.level ?? null,
    pattern: input.pattern ?? null,
    limit: input.limit ?? null,
    clear: input.clear ?? null,
  };
}

function toNetworkOptions(input: z.infer<typeof readNetworkRequestsActionSchema.schema>): NetworkReadOptions {
  return {
    urlPattern: input.url_pattern ?? null,
    onlyFailed: input.only_failed ?? null,
    limit: input.limit ?? null,
    clear: input.clear ?? null,
  };
}

export function createReadConsoleMessagesAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof readConsoleMessagesActionSchema.schema>) => {
    const intent = input.intent || t('act_readConsoleMessages_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.readConsoleMessages) return engineUnsupportedResult(context);
    const entries = page.readConsoleMessages(toConsoleOptions(input));
    if (entries.length === 0) {
      const msg = t('act_readConsoleMessages_none');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }
    const msg = t('act_readConsoleMessages_ok', [entries.length.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: wrapUntrustedContent(formatConsoleEntries(entries)),
      includeInMemory: true,
    });
  }, readConsoleMessagesActionSchema);
}

export function createReadNetworkRequestsAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof readNetworkRequestsActionSchema.schema>) => {
    const intent = input.intent || t('act_readNetworkRequests_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.readNetworkRequests) return engineUnsupportedResult(context);
    const entries = page.readNetworkRequests(toNetworkOptions(input));
    if (entries.length === 0) {
      const msg = t('act_readNetworkRequests_none');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }
    const msg = t('act_readNetworkRequests_ok', [entries.length.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: wrapUntrustedContent(formatNetworkEntries(entries)),
      includeInMemory: true,
    });
  }, readNetworkRequestsActionSchema);
}

export function createExecuteJavascriptAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof executeJavascriptActionSchema.schema>) => {
      const intent = input.intent || t('act_executeJavascript_start');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await context.browserContext.getCurrentPage();
      if (!page.evaluateScript) return engineUnsupportedResult(context);
      const outcome = await page.evaluateScript(input.script);
      // Script output and errors both come from the page, so both are untrusted; a thrown error is a finding, not a failure.
      const msg = outcome.ok ? t('act_executeJavascript_ok') : t('act_executeJavascript_fail');
      context.emitEvent(Actors.NAVIGATOR, outcome.ok ? ExecutionState.ACT_OK : ExecutionState.ACT_FAIL, msg);
      return new ActionResult({
        extractedContent: `${msg}\n${wrapUntrustedContent(outcome.text)}`,
        includeInMemory: true,
      });
    },
    executeJavascriptActionSchema,
    false,
  );
}

export function createResizeViewportAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof resizeViewportActionSchema.schema>) => {
    const page = await context.browserContext.getCurrentPage();
    if (!page.setViewportSize || !page.resetViewport) return engineUnsupportedResult(context);

    if (input.reset) {
      const intent = input.intent || t('act_resizeViewport_reset');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await page.resetViewport();
      const msg = t('act_resizeViewport_reset');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }

    if (input.width == null || input.height == null) {
      const msg = t('act_resizeViewport_needSize');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
    const size = `${input.width}x${input.height}`;
    const intent = input.intent || t('act_resizeViewport_start', [size]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    await page.setViewportSize({ width: input.width, height: input.height }, input.mobile ?? false);
    const msg = t('act_resizeViewport_ok', [size]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, resizeViewportActionSchema);
}
