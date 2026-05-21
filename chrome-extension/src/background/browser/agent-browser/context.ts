import {
  type BrowserContextConfig,
  type BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type TabInfo,
  URLNotAllowedError,
} from '../views';
import { createLogger } from '@src/background/log';
import { isUrlAllowed } from '../util';
import type { BrowserContextLike, BrowserEngineName, BrowserPageLike } from '../types';
import type { AgentBrowserCompanionClient } from './client';
import AgentBrowserPage from './page';

const logger = createLogger('AgentBrowserContext');

const DEFAULT_TAB_ID = 1;

export default class AgentBrowserContext implements BrowserContextLike {
  private config: BrowserContextConfig;
  private currentTab: number | null = DEFAULT_TAB_ID;
  private sessionId = 'default';
  private readonly companionClient: AgentBrowserCompanionClient;
  private readonly page: AgentBrowserPage;

  constructor(config: Partial<BrowserContextConfig>, companionClient: AgentBrowserCompanionClient) {
    this.config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this.companionClient = companionClient;
    this.page = new AgentBrowserPage({
      tabIdProvider: () => this.currentTab ?? DEFAULT_TAB_ID,
      sessionIdProvider: () => this.sessionId,
      taskIdProvider: () => this.sessionId,
      getConfig: () => this.config,
      client: this.companionClient,
    });
  }

  get currentTabId(): number | null {
    return this.currentTab;
  }

  getEngineName(): BrowserEngineName {
    return 'agent-browser-v1';
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId.trim() || 'default';
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getConfig(): BrowserContextConfig {
    return this.config;
  }

  updateConfig(config: Partial<BrowserContextConfig>): void {
    this.config = { ...this.config, ...config };
  }

  updateCurrentTabId(tabId: number): void {
    void tabId;
    this.currentTab = DEFAULT_TAB_ID;
  }

  async cleanup(): Promise<void> {
    await this.page.close();
  }

  async attachPage(page: BrowserPageLike): Promise<boolean> {
    void page;
    return true;
  }

  async detachPage(tabId: number): Promise<void> {
    void tabId;
    // No-op in isolated BrowserManager mode.
  }

  removeAttachedPage(tabId: number): void {
    void tabId;
    // No-op in isolated BrowserManager mode.
  }

  async getCurrentPage(): Promise<BrowserPageLike> {
    if (this.currentTab === null) {
      this.currentTab = DEFAULT_TAB_ID;
    }
    return this.page;
  }

  async getAllTabIds(): Promise<Set<number>> {
    const tabInfos = await this.getTabInfos();
    return new Set(tabInfos.map(tab => tab.id));
  }

  async switchTab(tabId: number): Promise<BrowserPageLike> {
    this.currentTab = DEFAULT_TAB_ID;
    logger.debug('switchTab in agent-browser mode maps to current chrome tab reference only', tabId);
    return this.page;
  }

  async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this.config.allowedUrls, this.config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }
    await this.page.navigateTo(url);
  }

  async openTab(url: string): Promise<BrowserPageLike> {
    if (!isUrlAllowed(url, this.config.allowedUrls, this.config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    const response = await this.companionClient.request(this.sessionId, this.sessionId, {
      action: 'tab_new',
      url,
      waitUntil: 'domcontentloaded',
    });

    if (!response.success) {
      throw new Error(response.error.message);
    }

    this.currentTab = (response.data.tabs?.find(tab => tab.active)?.index ?? DEFAULT_TAB_ID) + 1;
    return this.page;
  }

  async closeTab(tabId: number): Promise<void> {
    const response = await this.companionClient.request(this.sessionId, this.sessionId, {
      action: 'tab_close',
      tabIndex: Math.max(0, tabId - 1),
    });
    if (!response.success) {
      throw new Error(response.error.message);
    }
    this.currentTab = DEFAULT_TAB_ID;
  }

  async getTabInfos(): Promise<TabInfo[]> {
    const response = await this.companionClient.request(this.sessionId, this.sessionId, { action: 'tab_list' });
    if (!response.success) {
      throw new Error(response.error.message);
    }

    const tabs = response.data.tabs ?? [];
    if (tabs.length === 0) {
      const page = await this.getCurrentPage();
      return [
        {
          id: page.tabId,
          url: page.url(),
          title: await page.title(),
        },
      ];
    }

    return tabs.map(tab => ({
      id: tab.index + 1,
      url: tab.url,
      title: tab.title,
    }));
  }

  async getCachedState(useVision = false): Promise<BrowserState> {
    const page = await this.getCurrentPage();
    let state = page.getCachedState();
    if (!state) {
      state = await page.getState(useVision, false);
    }
    const tabs = await this.getTabInfos();
    return {
      ...state,
      tabs,
    };
  }

  async getState(useVision = false): Promise<BrowserState> {
    const page = await this.getCurrentPage();
    const state = await page.getState(useVision, false);
    const tabs = await this.getTabInfos();
    return {
      ...state,
      tabs,
    };
  }

  async removeHighlight(): Promise<void> {
    const page = await this.getCurrentPage();
    await page.removeHighlight();
  }
}
