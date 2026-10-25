// Read-only crawl planning for map_site: which URLs belong to the site and how many pages to read.
// Pure, so same-host filtering and the page cap are tested without a browser or a network.

export const SITE_MAP_MAX_PAGES = 15;

const NON_PAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|pdf|zip|gz|mp[34]|webm|woff2?|ttf|xml|json|txt)$/i;
const HREF_PATTERN = /href\s*=\s*["']([^"'#][^"']*)["']/gi;

/** Resolves a link against its page and keeps it only when it is an http(s) page on the same host. */
export function normalizeSiteUrl(href: string, base: string, host: string): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname.toLowerCase() !== host.toLowerCase()) return null;
  if (NON_PAGE_EXTENSION.test(url.pathname)) return null;
  url.hash = '';
  return url.href;
}

/** Every href value in an HTML document, in document order, with duplicates kept. */
export function extractHrefs(html: string): string[] {
  return [...html.matchAll(HREF_PATTERN)].map(match => match[1]);
}

export interface CrawlQueue {
  /** The next URL to read, or undefined when the crawl is finished. */
  next: () => string | undefined;
  /** Queues the same-host links of a page that is not queued yet. Stops at the page cap. */
  enqueue: (hrefs: string[], base: string) => void;
}

/**
 * A breadth-first queue over one host. Every URL is queued at most once, and the total never exceeds maxPages,
 * so the crawl reads at most that many pages.
 */
export function createCrawlQueue(startUrl: string, maxPages: number): CrawlQueue {
  const host = new URL(startUrl).hostname;
  const seen = new Set<string>();
  const pending: string[] = [];
  const add = (url: string | null): void => {
    if (url === null || seen.has(url) || seen.size >= maxPages) return;
    seen.add(url);
    pending.push(url);
  };
  add(normalizeSiteUrl(startUrl, startUrl, host));
  return {
    next: () => pending.shift(),
    enqueue: (hrefs, base) => {
      for (const href of hrefs) add(normalizeSiteUrl(href, base, host));
    },
  };
}
