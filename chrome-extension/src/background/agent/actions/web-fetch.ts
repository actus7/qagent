import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { Action } from './action';
import { actionErrorResult, clipText } from './shared';
import { webFetchActionSchema } from './schemas';

// ponytail: a plain fetch of the whole body, cut afterwards. Add a streamed read if large downloads matter.
const WEB_FETCH_TIMEOUT_MS = 20_000;

const HTML_ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  // Last, so "&amp;lt;" decodes once to "&lt;" and not to "<".
  [/&amp;/g, '&'],
];

/** Readable text from HTML with a simple strip: no DOM, so scripts and styles are dropped by pattern. */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|li|tr|h[1-6]|section|article|header|footer|br)\b[^>]*>/gi, '\n');
  // Tags go before entities: a decoded "&lt;" must stay text, not become a tag to strip.
  const untagged = withoutBlocks.replace(/<[^>]+>/g, ' ');
  const decoded = HTML_ENTITIES.reduce((text, [pattern, value]) => text.replace(pattern, value), untagged);
  return decoded
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Converts a response body to the requested format; invalid JSON throws. */
export function formatFetchedBody(body: string, contentType: string, format: 'text' | 'html' | 'json'): string {
  if (format === 'json') return JSON.stringify(JSON.parse(body), null, 2);
  if (format === 'text' && contentType.includes('html')) return htmlToText(body);
  return body;
}

export function createWebFetchAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof webFetchActionSchema.schema>) => {
    const intent = input.intent || t('act_webFetch_start', [input.url]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const failure = (reason: string) => {
      const msg = t('act_webFetch_fail', [input.url]);
      return actionErrorResult(context, msg, `${msg}: ${reason}`);
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(input.url, { redirect: 'follow', signal: controller.signal });
      if (!response.ok) return failure(`HTTP ${response.status}`);
      const body = await response.text();
      const content = formatFetchedBody(body, response.headers.get('Content-Type') ?? '', input.format);
      const msg = t('act_webFetch_ok', [input.url]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      // Fetched pages are untrusted content, like the page state.
      return new ActionResult({
        extractedContent: `${msg}\n${wrapUntrustedContent(clipText(content, input.maxLength))}`,
        includeInMemory: true,
      });
    } catch (error) {
      const reason = controller.signal.aborted
        ? 'timed out'
        : error instanceof SyntaxError
          ? 'response is not valid JSON'
          : error instanceof Error
            ? error.message
            : String(error);
      return failure(reason);
    } finally {
      clearTimeout(timer);
    }
  }, webFetchActionSchema);
}
