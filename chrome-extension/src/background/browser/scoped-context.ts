import BrowserContext from './context';
import type { BrowserPageLike } from './types';
import { isUrlAllowed } from './util';

/** Only explicitly selected tabs and tabs created by this task are exposed to the agent. */
export default class ScopedBrowserContext extends BrowserContext {
  private allowedTabs = new Set<number>();
  private readonly onTabCreated = (tab: chrome.tabs.Tab) => {
    if (tab.id !== undefined && tab.openerTabId !== undefined && this.allowedTabs.has(tab.openerTabId)) {
      this.allowedTabs.add(tab.id);
    }
  };

  setAllowedTabs(tabIds: number[]): void {
    this.allowedTabs = new Set(tabIds);
    chrome.tabs.onCreated?.removeListener(this.onTabCreated);
    chrome.tabs.onCreated?.addListener(this.onTabCreated);
  }

  private async assertTabAllowed(tabId: number): Promise<void> {
    if (!this.allowedTabs.has(tabId)) throw new Error('Esta aba não foi incluída na tarefa.');
    const tab = await chrome.tabs.get(tabId);
    const { allowedUrls, deniedUrls } = this.getConfig();
    if (
      !tab.url ||
      !/^https?:\/\//i.test(tab.url) ||
      new URL(tab.url).hostname === 'chromewebstore.google.com' ||
      !isUrlAllowed(tab.url, allowedUrls, deniedUrls)
    ) {
      throw new Error('Esta página não permite acesso ou foi bloqueada pelo firewall.');
    }
  }

  override async getCurrentPage(): Promise<BrowserPageLike> {
    if (this.currentTabId === null) throw new Error('Selecione uma aba para executar a tarefa.');
    try {
      await this.assertTabAllowed(this.currentTabId);
    } catch {
      // The current tab was closed or blocked: continue on another tab in scope instead of failing every step
      await this.switchToFirstUsableTab();
    }
    return super.getCurrentPage();
  }

  private async switchToFirstUsableTab(): Promise<void> {
    for (const tabId of this.allowedTabs) {
      try {
        await this.switchTab(tabId);
        return;
      } catch {
        // closed or not allowed anymore, try the next one
      }
    }
    throw new Error('Nenhuma aba disponível para continuar a tarefa.');
  }

  override async switchTab(tabId: number): Promise<BrowserPageLike> {
    await this.assertTabAllowed(tabId);
    return super.switchTab(tabId);
  }

  override async closeTab(tabId: number): Promise<void> {
    await this.assertTabAllowed(tabId);
    await super.closeTab(tabId);
    this.allowedTabs.delete(tabId);
  }

  override async openTab(url: string): Promise<BrowserPageLike> {
    if (!/^https?:\/\//i.test(url)) throw new Error('Somente páginas HTTP e HTTPS são permitidas.');
    // Parent implementation validates the firewall and attaches only the newly created tab.
    const page = await super.openTab(url);
    this.allowedTabs.add(page.tabId);
    return page;
  }

  override async getTabInfos() {
    const tabs = await super.getTabInfos();
    const { allowedUrls, deniedUrls } = this.getConfig();
    return tabs.filter(tab => this.allowedTabs.has(tab.id) && isUrlAllowed(tab.url, allowedUrls, deniedUrls));
  }

  override async getAllTabIds(): Promise<Set<number>> {
    return new Set((await this.getTabInfos()).map(tab => tab.id));
  }

  override async cleanup(): Promise<void> {
    // The user may have closed the current tab; cleanup must never open or attach another tab.
    chrome.tabs.onCreated?.removeListener(this.onTabCreated);
    await super.cleanup();
  }
}
