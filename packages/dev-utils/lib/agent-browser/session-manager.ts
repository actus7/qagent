import { BrowserManager, type ScreencastFrame, type ScreencastOptions } from 'agent-browser/dist/browser.js';

export type BrowserManagerLaunchOptions = Omit<Parameters<BrowserManager['launch']>[0], 'id' | 'action'>;

export interface BrowserSessionManagerOptions {
  launch?: BrowserManagerLaunchOptions;
  sessionTimeoutMs?: number;
  onScreencastFrame?: (sessionId: string, frame: ScreencastFrame) => void;
}

interface BrowserSession {
  browser: BrowserManager;
  timer: ReturnType<typeof setTimeout>;
  lastActiveAt: number;
}

const DEFAULT_SESSION_TIMEOUT_V1_MS = 15 * 60 * 1000;

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly launchOptions: BrowserManagerLaunchOptions;
  private readonly sessionTimeoutMs: number;
  private readonly onScreencastFrame?: (sessionId: string, frame: ScreencastFrame) => void;

  constructor(options: BrowserSessionManagerOptions = {}) {
    this.launchOptions = options.launch ?? { headless: true };
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_V1_MS;
    this.onScreencastFrame = options.onScreencastFrame;
  }

  async getBrowser(sessionId: string): Promise<BrowserManager> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.touchSession(sessionId, existing);
      return existing.browser;
    }

    const browser = new BrowserManager();

    await browser.launch({
      id: `launch-${sessionId}-${Date.now()}`,
      action: 'launch',
      ...this.launchOptions,
    } as Parameters<BrowserManager['launch']>[0]);

    const timer = this.createSessionTimer(sessionId);

    this.sessions.set(sessionId, {
      browser,
      timer,
      lastActiveAt: Date.now(),
    });

    return browser;
  }

  async getPage(sessionId: string): Promise<ReturnType<BrowserManager['getPage']>> {
    const browser = await this.getBrowser(sessionId);
    return browser.getPage();
  }

  listSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async startScreencast(
    sessionId: string,
    options?: ScreencastOptions,
    onFrame?: (frame: ScreencastFrame) => void,
  ): Promise<void> {
    const browser = await this.getBrowser(sessionId);
    if (browser.isScreencasting()) {
      this.touchSession(sessionId, this.sessions.get(sessionId));
      return;
    }
    const frameHandler = onFrame ?? ((frame: ScreencastFrame) => this.onScreencastFrame?.(sessionId, frame));

    if (!frameHandler) {
      throw new Error(
        'No screencast callback provided. Set onFrame or configure onScreencastFrame in manager options.',
      );
    }

    await browser.startScreencast(frameHandler, options);
    this.touchSession(sessionId, this.sessions.get(sessionId));
  }

  async injectMouseEvent(
    sessionId: string,
    params: Parameters<BrowserManager['injectMouseEvent']>[0],
  ): Promise<void> {
    const browser = await this.getBrowser(sessionId);
    await browser.injectMouseEvent(params);
    this.touchSession(sessionId, this.sessions.get(sessionId));
  }

  async injectKeyboardEvent(
    sessionId: string,
    params: Parameters<BrowserManager['injectKeyboardEvent']>[0],
  ): Promise<void> {
    const browser = await this.getBrowser(sessionId);
    await browser.injectKeyboardEvent(params);
    this.touchSession(sessionId, this.sessions.get(sessionId));
  }

  async injectTouchEvent(
    sessionId: string,
    params: Parameters<BrowserManager['injectTouchEvent']>[0],
  ): Promise<void> {
    const browser = await this.getBrowser(sessionId);
    await browser.injectTouchEvent(params);
    this.touchSession(sessionId, this.sessions.get(sessionId));
  }

  async isScreencasting(sessionId: string): Promise<boolean> {
    const browser = await this.getBrowser(sessionId);
    return browser.isScreencasting();
  }

  async stopScreencast(sessionId: string): Promise<void> {
    const browser = await this.getBrowser(sessionId);
    if (browser.isScreencasting()) {
      await browser.stopScreencast();
    }
    this.touchSession(sessionId, this.sessions.get(sessionId));
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    clearTimeout(session.timer);

    try {
      if (session.browser.isScreencasting()) {
        await session.browser.stopScreencast();
      }
    } catch {
      // Ignore screencast stop errors during cleanup.
    }

    await session.browser.close();
    this.sessions.delete(sessionId);
    return true;
  }

  async closeAll(): Promise<void> {
    const sessionIds = this.listSessionIds();
    await Promise.all(sessionIds.map(async sessionId => this.closeSession(sessionId)));
  }

  private createSessionTimer(sessionId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.closeSession(sessionId);
    }, this.sessionTimeoutMs);
  }

  private touchSession(sessionId: string, session?: BrowserSession): void {
    if (!session) {
      return;
    }

    clearTimeout(session.timer);
    session.lastActiveAt = Date.now();
    session.timer = this.createSessionTimer(sessionId);
  }
}
