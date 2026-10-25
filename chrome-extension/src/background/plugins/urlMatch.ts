import type { BrowserPlugin } from '@extension/storage';

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** `*` matches any run of characters; everything else is literal. Matching is case-insensitive. */
function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split('*').map(escapeRegExp).join('.*')}$`, 'i');
}

/**
 * Matches a URL against a glob.
 * - Contains "://": matched against the full URL, e.g. `https://shop.example.com/*`.
 * - Contains "/" but no scheme: matched against host + path, e.g. `shop.example.com/cart*`.
 * - Otherwise a host glob, e.g. `example.com` or `*.example.com`.
 */
export function matchesUrlGlob(glob: string, url: string): boolean {
  const pattern = glob.trim();
  if (!pattern) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    // Pages such as about:blank or chrome:// pages without a parseable URL simply match no glob.
    return false;
  }
  if (pattern.includes('://')) return globToRegExp(pattern).test(target.href);
  if (!pattern.includes('/')) return globToRegExp(pattern).test(target.hostname);
  return globToRegExp(pattern).test(`${target.hostname}${target.pathname}${target.search}`);
}

/** An enabled plugin applies to a page when it has no match globs (every site) or one of them matches. */
export function pluginAppliesToUrl(plugin: BrowserPlugin, url: string): boolean {
  if (!plugin.enabled) return false;
  return plugin.matches.length === 0 || plugin.matches.some(glob => matchesUrlGlob(glob, url));
}
