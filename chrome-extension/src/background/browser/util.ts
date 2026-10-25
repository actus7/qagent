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
