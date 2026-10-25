import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { formatTheme } from '../../browser/page-visual';
import { recordStepScreenshot } from '../../services/step-screenshots';
import { Action } from './action';
import { actionFailedResult, engineUnsupportedResult } from './shared';
import { auditContrastActionSchema, readThemeActionSchema, screenshotActionSchema } from './schemas';

const MAX_REPORTED_FAILURES = 30;

export function createScreenshotAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof screenshotActionSchema.schema>) => {
    const intent = input.intent || t('act_screenshot_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.captureFullPage) return engineUnsupportedResult(context);
    try {
      // Only the full-page capture is implemented; a viewport capture is the regular vision screenshot.
      const shot = await page.captureFullPage();
      await recordStepScreenshot(context.taskId, context.nSteps + 1, shot.base64).catch(() => undefined);
      const cut = shot.truncated ? ` ${t('act_screenshot_cut')}` : '';
      const msg = t('act_screenshot_ok', [String(shot.width), String(shot.height), shot.method]) + cut;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, screenshotActionSchema);
}

export function createReadThemeAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof readThemeActionSchema.schema>) => {
    const intent = input.intent || t('act_theme_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.readTheme) return engineUnsupportedResult(context);
    try {
      const theme = await page.readTheme();
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, t('act_theme_ok'));
      return new ActionResult({ extractedContent: wrapUntrustedContent(formatTheme(theme)), includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, readThemeActionSchema);
}

export function createAuditContrastAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof auditContrastActionSchema.schema>) => {
    const intent = input.intent || t('act_contrast_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.auditContrast) return engineUnsupportedResult(context);
    try {
      const audit = await page.auditContrast(input.max_samples);
      const failing = audit.failures.slice(0, MAX_REPORTED_FAILURES);
      const lines = failing.map(
        item =>
          `- "${item.text}" ${item.ratio.toFixed(2)}:1 (needs ${item.required}:1${item.large ? ', large text' : ''})`,
      );
      const msg = t('act_contrast_ok', [String(audit.checked), String(audit.failures.length)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      const body = lines.length ? `\n${wrapUntrustedContent(lines.join('\n'))}` : '';
      return new ActionResult({ extractedContent: `${msg}${body}`, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, auditContrastActionSchema);
}
