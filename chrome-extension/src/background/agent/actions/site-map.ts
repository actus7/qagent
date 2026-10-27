import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import { browserPluginsStore, type BrowserPlugin } from '@extension/storage';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { createCrawlQueue, extractHrefs, SITE_MAP_MAX_PAGES } from '../site-map/crawl';
import { factsFromHtml, formatSiteReport, reportFromFacts, type PageFacts, type PageReport } from '../site-map/report';
import { summarizeSiteReport } from '../site-map/summary';
import { Action } from './action';
import { mapSiteActionSchema } from './schemas';
import { actionErrorResult } from './shared';

const FETCH_TIMEOUT_MS = 10_000;
// Read on the live page: the DOM after scripts ran, which a fetch cannot see. Returns facts, not HTML, so it fits the result cap.
const LIVE_FACTS_SCRIPT = `(() => ({
  title: document.title,
  headings: [...document.querySelectorAll('h1,h2')].map(h => (h.textContent || '').trim()).filter(Boolean).slice(0, 5),
  navCount: document.querySelectorAll('nav').length,
  forms: document.querySelectorAll('form').length,
  hasMain: !!document.querySelector('main,[role=main]'),
  hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(Boolean).slice(0, 120),
}))()`;

const isFacts = (value: unknown): value is PageFacts =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PageFacts).title === 'string' &&
  Array.isArray((value as PageFacts).hrefs);

/** The site map is stored under a fixed id per host, so a rerun replaces the earlier map. */
export const siteMapPluginId = (host: string): string => `sitemap-${host.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 50)}`;

export function buildSiteMapPlugin(
  host: string,
  instructions: string,
  existing: BrowserPlugin | undefined,
  now: number,
): BrowserPlugin {
  return {
    id: siteMapPluginId(host),
    name: `Site map: ${host}`.slice(0, 80),
    description: 'Site map built by the agent from a read-only crawl of this host',
    version: '1.0.0',
    // Refreshing the map never re-enables a map the user switched off.
    enabled: existing?.enabled ?? true,
    matches: [host],
    instructions,
    tools: [],
    createdBy: 'agent',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function fetchFacts(url: string, signal: AbortSignal): Promise<PageFacts | null> {
  const response = await fetch(url, { redirect: 'follow', signal });
  // A redirect off the crawled host would break the same-host promise of the map.
  if (response.url && new URL(response.url).hostname !== new URL(url).hostname) return null;
  if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('html')) return null;
  const html = await response.text();
  return factsFromHtml(html, extractHrefs(html));
}

/** Runs the facts script on the page and parses its JSON result; a failed or truncated result throws. */
function evaluateFacts(
  evaluate: ((script: string) => Promise<{ ok: boolean; text: string }>) | undefined,
): ((script: string) => Promise<unknown>) | undefined {
  if (!evaluate) return undefined;
  return async script => {
    const outcome = await evaluate(script);
    if (!outcome.ok) throw new Error(outcome.text);
    return JSON.parse(outcome.text);
  };
}

/** Facts for one page: the live DOM for the current page, a fetch for every other URL. Null when the page cannot be read. */
async function readPage(
  url: string,
  live: { url: string; evaluate?: (script: string) => Promise<unknown> },
): Promise<PageFacts | null> {
  if (url === live.url && live.evaluate) {
    try {
      const value = await live.evaluate(LIVE_FACTS_SCRIPT);
      if (isFacts(value)) return value;
    } catch {
      // Fall through to a fetch: the live read is an improvement, not a requirement.
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchFacts(url, controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createMapSiteAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof mapSiteActionSchema.schema>) => {
    const intent = input.intent || t('act_mapSite_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const fail = (msg: string) => {
      return actionErrorResult(context, msg);
    };

    const page = await context.browserContext.getCurrentPage();
    const currentUrl = page.url();
    const startUrl = input.url ?? currentUrl;
    let host: string;
    try {
      const start = new URL(startUrl);
      if (start.protocol !== 'https:' && start.protocol !== 'http:') return fail(t('act_mapSite_badUrl'));
      host = start.hostname;
    } catch {
      return fail(t('act_mapSite_badUrl'));
    }

    const queue = createCrawlQueue(startUrl, Math.min(input.maxPages, SITE_MAP_MAX_PAGES));
    const live = { url: currentUrl, evaluate: evaluateFacts(page.evaluateScript?.bind(page)) };
    const reports: PageReport[] = [];
    for (let url = queue.next(); url !== undefined; url = queue.next()) {
      if (context.controller.signal.aborted) break;
      const facts = await readPage(url, live);
      if (!facts) continue;
      reports.push(reportFromFacts(url, facts));
      queue.enqueue(facts.hrefs, url);
    }
    if (reports.length === 0) return fail(t('act_mapSite_empty', [host]));

    const existing = await browserPluginsStore.getPlugin(siteMapPluginId(host));
    if (existing?.createdBy === 'user') return fail(t('act_mapSite_userPlugin', [existing.name]));
    const summary = await summarizeSiteReport(formatSiteReport(host, reports), 'navigator');
    await browserPluginsStore.save(buildSiteMapPlugin(host, summary, existing, Date.now()));

    const msg = t('act_mapSite_ok', [host, String(reports.length)]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: `${msg}\n${wrapUntrustedContent(summary)}`, includeInMemory: true });
  }, mapSiteActionSchema);
}
