import ScopedBrowserContext from '../scoped-context';
import type { BrowserEngineName, BrowserPageLike } from '../types';
import ContentScriptPage from './page';

/**
 * Tab scoping, tab switching and navigation are inherited from the chrome-debugger context. Only the page object
 * differs: it drives the tab through chrome.scripting instead of a Puppeteer session.
 */
export default class ContentScriptBrowserContext extends ScopedBrowserContext {
  override getEngineName(): BrowserEngineName {
    return 'content-script';
  }

  protected override createPage(tabId: number, url: string, title: string): BrowserPageLike {
    return new ContentScriptPage(tabId, url, title, () => this.getConfig());
  }
}
