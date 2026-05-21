import {
  BrowserManager as InternalBrowserManager,
  type ScreencastFrame,
  type ScreencastOptions,
} from 'agent-browser/dist/browser.js';

export type BrowserLaunchOptions = Omit<Parameters<InternalBrowserManager['launch']>[0], 'id' | 'action'>;

export type BrowserMouseEvent = Parameters<InternalBrowserManager['injectMouseEvent']>[0];
export type BrowserKeyboardEvent = Parameters<InternalBrowserManager['injectKeyboardEvent']>[0];
export type BrowserTouchEvent = Parameters<InternalBrowserManager['injectTouchEvent']>[0];

export class BrowserManager {
  private readonly manager: InternalBrowserManager;

  constructor() {
    this.manager = new InternalBrowserManager();
  }

  async launch(options: BrowserLaunchOptions = { headless: true }): Promise<void> {
    await this.manager.launch({
      id: `launch-${Date.now()}`,
      action: 'launch',
      ...options,
    } as Parameters<InternalBrowserManager['launch']>[0]);
  }

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded',
  ): Promise<void> {
    await this.manager.getPage().goto(url, { waitUntil });
  }

  async getPage(): Promise<ReturnType<InternalBrowserManager['getPage']>> {
    return this.manager.getPage();
  }

  async startScreencast(callback: (frame: ScreencastFrame) => void, options?: ScreencastOptions): Promise<void> {
    await this.manager.startScreencast(callback, options);
  }

  async stopScreencast(): Promise<void> {
    if (this.manager.isScreencasting()) {
      await this.manager.stopScreencast();
    }
  }

  async injectMouseEvent(params: BrowserMouseEvent): Promise<void> {
    await this.manager.injectMouseEvent(params);
  }

  async injectKeyboardEvent(params: BrowserKeyboardEvent): Promise<void> {
    await this.manager.injectKeyboardEvent(params);
  }

  async injectTouchEvent(params: BrowserTouchEvent): Promise<void> {
    await this.manager.injectTouchEvent(params);
  }

  async close(): Promise<void> {
    await this.manager.close();
  }
}
