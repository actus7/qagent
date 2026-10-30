/**
 * Whether a tab URL is a page QAgent can attach to and draw on: plain http(s), but not the Chrome Web Store.
 * Chrome's own pages (chrome://, the new tab page) and extension pages refuse debugger attachment and content scripts.
 */
export function isAutomatableWebUrl(url: string | undefined): boolean {
  const lower = url?.trim().toLowerCase() ?? '';
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
  return !lower.startsWith('https://chromewebstore.google.com');
}
