import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { describeTargetSpec } from '../../browser/target-resolver';
import { armDownloadCapture, listRecentDownloads } from '../../services/downloads';
import { Action } from './action';
import { actionFailedResult, elementNotExistResult, engineUnsupportedResult, missingLocatorResult } from './shared';
import { captureDownloadActionSchema, listDownloadsActionSchema } from './schemas';

/** Arms the download watch first, then clicks, so a download that starts at once is not missed. */
export function createCaptureDownloadAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof captureDownloadActionSchema.schema>) => {
      if (input.index === undefined && !input.target) return missingLocatorResult(context);
      const label = input.target ? describeTargetSpec(input.target) : `@e${input.index}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, input.intent || t('act_download_start', [label]));
      const page = await context.browserContext.getCurrentPage();
      if (!page.clickByTarget || !page.clickBySelector) return engineUnsupportedResult(context);
      if (input.index !== undefined && !page.getDomElementBySelector(`@e${input.index}`)) {
        return elementNotExistResult(context, input.index);
      }
      const capture = armDownloadCapture();
      try {
        if (input.target) await page.clickByTarget(input.target);
        else await page.clickBySelector(false, `@e${input.index}`);
        const download = await capture.wait(input.timeout_ms);
        if (!download) {
          const msg = t('act_download_none', [String(Math.round(input.timeout_ms / 1000))]);
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          return new ActionResult({ error: msg, includeInMemory: true });
        }
        if (download.state === 'interrupted') {
          const msg = t('act_download_interrupted', [wrapUntrustedContent(download.filename || label)]);
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          return new ActionResult({ error: msg, includeInMemory: true });
        }
        const msg = t('act_download_ok', [wrapUntrustedContent(download.filename)]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        return actionFailedResult(context, error);
      } finally {
        capture.release();
      }
    },
    captureDownloadActionSchema,
    true,
  );
}

export function createListDownloadsAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof listDownloadsActionSchema.schema>) => {
    const intent = input.intent || t('act_listDownloads_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    try {
      const downloads = await listRecentDownloads(input.limit);
      if (downloads.length === 0) {
        const msg = t('act_listDownloads_none');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      const lines = downloads.map(
        item => `- id ${item.id} [${item.state}] ${item.filename} (from ${wrapUntrustedContent(item.url)})`,
      );
      const msg = t('act_listDownloads_ok', [String(downloads.length)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: `${msg}\n${lines.join('\n')}`, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, listDownloadsActionSchema);
}
