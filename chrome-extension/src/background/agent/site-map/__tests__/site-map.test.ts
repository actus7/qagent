import { describe, expect, it } from 'vitest';
import { createCrawlQueue, extractHrefs, normalizeSiteUrl, SITE_MAP_MAX_PAGES } from '../crawl';
import { factsFromHtml, formatSiteReport, reportFromFacts } from '../report';
import { siteMapPluginId } from '../../actions/site-map';

const HOST = 'shop.example.com';
const BASE = `https://${HOST}/`;

describe('normalizeSiteUrl', () => {
  it('keeps same-host http and https pages and resolves relative links', () => {
    expect(normalizeSiteUrl('/cart', BASE, HOST)).toBe(`https://${HOST}/cart`);
    expect(normalizeSiteUrl('http://shop.example.com/a#top', BASE, HOST)).toBe(`http://${HOST}/a`);
  });

  it('drops other hosts, other schemes and asset files', () => {
    expect(normalizeSiteUrl('https://other.example.com/x', BASE, HOST)).toBeNull();
    expect(normalizeSiteUrl('mailto:a@b.com', BASE, HOST)).toBeNull();
    expect(normalizeSiteUrl('/logo.png', BASE, HOST)).toBeNull();
    expect(normalizeSiteUrl('/docs/manual.pdf', BASE, HOST)).toBeNull();
  });
});

describe('createCrawlQueue', () => {
  it('queues only same-host links, each once', () => {
    const queue = createCrawlQueue(BASE, SITE_MAP_MAX_PAGES);
    expect(queue.next()).toBe(BASE);
    queue.enqueue(['/a', '/a', 'https://evil.example.org/', '/b'], BASE);
    expect([queue.next(), queue.next(), queue.next()]).toEqual([`https://${HOST}/a`, `https://${HOST}/b`, undefined]);
  });

  it('never queues more pages than the cap', () => {
    const queue = createCrawlQueue(BASE, 3);
    queue.enqueue(['/a', '/b', '/c', '/d'], BASE);
    const visited = [queue.next(), queue.next(), queue.next(), queue.next()];
    expect(visited.filter(Boolean)).toHaveLength(3);
  });

  it('caps the site crawl at 15 pages by default', () => {
    expect(SITE_MAP_MAX_PAGES).toBe(15);
  });

  it('reads links out of HTML in document order', () => {
    expect(extractHrefs('<a href="/x">a</a><link href=\'/y\'><a href="#skip">b</a>')).toEqual(['/x', '/y']);
  });
});

describe('site report', () => {
  const html = `<html><head><title>Loja</title></head><body>
    <nav><a href="/cart">Carrinho</a></nav>
    <main><h1>Ofertas</h1><form action="/search"></form></main>
  </body></html>`;

  it('summarises a page with its counts and no quirks when it is complete', () => {
    const report = reportFromFacts(BASE, factsFromHtml(html, extractHrefs(html)));
    expect(report).toEqual({
      url: BASE,
      title: 'Loja',
      headings: ['Ofertas'],
      navCount: 1,
      forms: 1,
      links: 1,
      quirks: [],
    });
  });

  it('names the quirks of a page that lacks a title, a heading and a main landmark', () => {
    const report = reportFromFacts(BASE, factsFromHtml('<div>x</div>', []));
    expect(report.quirks).toEqual(['no title', 'no h1 or h2', 'no main landmark']);
  });

  it('formats one line per page and clips the whole report', () => {
    const page = reportFromFacts(BASE, factsFromHtml(html, extractHrefs(html)));
    const text = formatSiteReport(HOST, [page]);
    expect(text.split('\n')[0]).toBe(`Site map of ${HOST}: 1 pages read.`);
    expect(text).toContain(`- ${BASE} | Loja | nav 1, forms 1, links 1 | headings: Ofertas`);
    expect(formatSiteReport(HOST, [page], 40).endsWith('...[truncated]')).toBe(true);
  });

  it('uses a stable plugin id per host so a rerun replaces the map', () => {
    expect(siteMapPluginId(HOST)).toBe('sitemap-shop-example-com');
    expect(siteMapPluginId(HOST)).toBe(siteMapPluginId(HOST));
  });
});
