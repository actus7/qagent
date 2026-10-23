import { isManagedUrlAllowed } from '../state/managedPolicyState';

/**
 * Normalizes a firewall list entry so it compares with normalized hostnames:
 * lowercase, no scheme, no leading `*.` / `www.`, no trailing dots.
 */
function normalizeListEntry(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(\*\.|www\.)/, '')
    .replace(/\.+$/, '');
}

/**
 * Checks if a URL is allowed based on firewall configuration
 * @param url The URL to check
 * @param allowList The allow list
 * @param denyList The deny list
 * @returns True if the URL is allowed, false otherwise
 */
export function isUrlAllowed(url: string, allowList: string[], denyList: string[]): boolean {
  // Normalize and validate input
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return false;
  }

  const lowerCaseUrl = trimmedUrl.toLowerCase();

  // ALWAYS block chrome web store (scripts cannot be injected there), even if firewall is disabled
  if (lowerCaseUrl.startsWith('https://chromewebstore.google.com')) {
    return false;
  }

  // Scheme allowlist: only web pages and about:blank can be reached
  const isAboutBlank = trimmedUrl === 'about:blank';
  if (!isAboutBlank && !/^https?:\/\//i.test(trimmedUrl)) {
    return false;
  }

  // Enterprise policy (managed blocked/allowed patterns) applies even when the firewall is disabled.
  if (!isManagedUrlAllowed(trimmedUrl)) {
    return false;
  }

  // If firewall is disabled, allow all other URLs
  if (allowList.length === 0 && denyList.length === 0) {
    return true;
  }

  if (isAboutBlank) {
    return true;
  }

  const allowEntries = allowList.map(normalizeListEntry);
  const denyEntries = denyList.map(normalizeListEntry);

  try {
    const parsedUrl = new URL(trimmedUrl);

    // 1. Remove protocol prefix for further comparisons
    const urlWithoutProtocol = lowerCaseUrl.replace(/^https?:\/\//, '');

    // 2. First check full URL against deny list
    for (const deniedEntry of denyEntries) {
      if (urlWithoutProtocol === deniedEntry) {
        return false;
      }
    }

    // 3. Check full URL against allow list
    for (const allowedEntry of allowEntries) {
      if (urlWithoutProtocol === allowedEntry) {
        return true;
      }
    }

    // 4. Extract domain for domain-based checks; trailing dots ("evil.com.") name the same host
    const domain = parsedUrl.hostname.toLowerCase().replace(/\.+$/, '');

    // 5. Check domain against deny list
    for (const deniedEntry of denyEntries) {
      if (domain === deniedEntry || domain.endsWith(`.${deniedEntry}`)) {
        return false;
      }
    }

    // 6. Check domain against allow list
    for (const allowedEntry of allowEntries) {
      if (domain === allowedEntry || domain.endsWith(`.${allowedEntry}`)) {
        return true;
      }
    }

    // Default policy
    return allowEntries.length === 0;
  } catch {
    // Invalid URL format - deny by default
    return false;
  }
}

// Check if a URL is a new tab page (about:blank or chrome://new-tab-page).
export function isNewTabPage(url: string): boolean {
  return url === 'about:blank' || url === 'chrome://new-tab-page' || url === 'chrome://new-tab-page/';
}

export function capTextLength(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '...';
  }
  return text;
}

/**
 * Resolve after the given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
