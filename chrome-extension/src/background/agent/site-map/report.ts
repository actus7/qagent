// What map_site reads from each page, and the compact text report the model summarises.
// Pure: input is HTML or a facts object from the live page, output is plain text.

export const SITE_REPORT_MAX_CHARS = 6000;
const MAX_HEADINGS = 5;
const MAX_HEADING_CHARS = 80;

export interface PageFacts {
  title: string;
  headings: string[];
  navCount: number;
  forms: number;
  hasMain: boolean;
  hrefs: string[];
}

export interface PageReport {
  url: string;
  title: string;
  headings: string[];
  navCount: number;
  forms: number;
  links: number;
  quirks: string[];
}

const stripTags = (fragment: string): string => fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const clipHeading = (text: string): string => text.slice(0, MAX_HEADING_CHARS);

/** Facts from a fetched HTML document, with the same shape the live page reports. */
export function factsFromHtml(html: string, hrefs: string[]): PageFacts {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map(match => clipHeading(stripTags(match[1])))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS);
  return {
    title,
    headings,
    navCount: (html.match(/<nav[\s>]/gi) ?? []).length,
    forms: (html.match(/<form[\s>]/gi) ?? []).length,
    hasMain: /<main[\s>]|role\s*=\s*["']main["']/i.test(html),
    hrefs,
  };
}

/** Turns page facts into the report line: counts, the headings and the quirks worth telling the agent about. */
export function reportFromFacts(url: string, facts: PageFacts): PageReport {
  const quirks: string[] = [];
  if (!facts.title) quirks.push('no title');
  if (facts.headings.length === 0) quirks.push('no h1 or h2');
  if (!facts.hasMain) quirks.push('no main landmark');
  return {
    url,
    title: facts.title,
    headings: facts.headings,
    navCount: facts.navCount,
    forms: facts.forms,
    links: facts.hrefs.length,
    quirks,
  };
}

const formatPage = (page: PageReport): string => {
  const headings = page.headings.length > 0 ? ` | headings: ${page.headings.join(' / ')}` : '';
  const quirks = page.quirks.length > 0 ? ` | quirks: ${page.quirks.join(', ')}` : '';
  return `- ${page.url} | ${page.title || '(untitled)'} | nav ${page.navCount}, forms ${page.forms}, links ${page.links}${headings}${quirks}`;
};

/** The plain-text report for one site, clipped so the summary request stays small. */
export function formatSiteReport(host: string, pages: PageReport[], maxChars = SITE_REPORT_MAX_CHARS): string {
  const text = [`Site map of ${host}: ${pages.length} pages read.`, ...pages.map(formatPage)].join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}...[truncated]` : text;
}
