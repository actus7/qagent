import type { BrowserSessionManager } from './session-manager';
import type { BrowserToolInput, BrowserToolResult } from './types';

function requireString(value: string | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Field "${fieldName}" is required for this action`);
  }
  return normalized;
}

async function getPageState(
  manager: BrowserSessionManager,
  sessionId: string,
): Promise<Pick<BrowserToolResult, 'url' | 'title'>> {
  const page = await manager.getPage(sessionId);
  const [url, title] = await Promise.all([page.url(), page.title()]);
  return { url, title };
}

export async function browserTool(manager: BrowserSessionManager, input: BrowserToolInput): Promise<BrowserToolResult> {
  try {
    const browser = await manager.getBrowser(input.sessionId);
    const page = browser.getPage();

    switch (input.action) {
      case 'open': {
        const url = requireString(input.url, 'url');
        await page.goto(url, { waitUntil: input.waitUntil ?? 'domcontentloaded' });
        const state = await getPageState(manager, input.sessionId);
        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
          ...state,
        };
      }

      case 'snapshot': {
        const snapshot = await browser.getSnapshot({
          interactive: input.interactive,
          cursor: input.cursor,
          compact: input.compact,
          maxDepth: input.maxDepth,
          selector: input.scopeSelector,
        });

        const state = await getPageState(manager, input.sessionId);
        const html = input.includeHtml ? await page.content() : undefined;

        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
          ...state,
          html,
          snapshotTree: snapshot.tree,
          refs: snapshot.refs,
        };
      }

      case 'click': {
        const selector = requireString(input.selector, 'selector');
        await browser.getLocator(selector).click();
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'fill': {
        const selector = requireString(input.selector, 'selector');
        const text = requireString(input.text, 'text');
        await browser.getLocator(selector).fill(text);
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'type': {
        const selector = requireString(input.selector, 'selector');
        const text = requireString(input.text, 'text');
        await browser.getLocator(selector).type(text);
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'press': {
        const key = requireString(input.key, 'key');
        await page.keyboard.press(key);
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'wait': {
        const timeout = input.timeoutMs ?? 10_000;

        if (typeof input.waitMs === 'number' && input.waitMs > 0) {
          await new Promise(resolve => setTimeout(resolve, input.waitMs));
        } else if (input.selector) {
          await browser.getLocator(input.selector).waitFor({ state: 'visible', timeout });
        } else if (input.waitText) {
          await page.getByText(input.waitText).first().waitFor({ state: 'visible', timeout });
        } else if (input.waitUrl) {
          await page.waitForURL(input.waitUrl, { timeout });
        } else if (input.waitLoadState) {
          await page.waitForLoadState(input.waitLoadState, { timeout });
        } else {
          throw new Error('wait requires one of: waitMs, selector, waitText, waitUrl, waitLoadState');
        }

        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'back': {
        await page.goBack({ waitUntil: input.waitUntil ?? 'domcontentloaded' });
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'forward': {
        await page.goForward({ waitUntil: input.waitUntil ?? 'domcontentloaded' });
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'reload': {
        await page.reload({ waitUntil: input.waitUntil ?? 'domcontentloaded' });
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'get': {
        const what = input.getWhat;
        if (!what) {
          throw new Error('Field "getWhat" is required for get action');
        }

        if (what === 'title') {
          const title = await page.title();
          const url = page.url();
          return { success: true, sessionId: input.sessionId, action: input.action, title, url };
        }

        if (what === 'url') {
          const url = page.url();
          const title = await page.title();
          return { success: true, sessionId: input.sessionId, action: input.action, url, title };
        }

        const selector = requireString(input.selector, 'selector');
        const locator = browser.getLocator(selector);
        let text: string;

        if (what === 'value') {
          text = await locator.inputValue();
        } else {
          text = (await locator.textContent())?.trim() ?? '';
        }

        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state, text };
      }

      case 'get_text': {
        const selector = requireString(input.selector, 'selector');
        const text = (await browser.getLocator(selector).textContent())?.trim() ?? '';
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state, text };
      }

      case 'get_title': {
        const title = await page.title();
        const url = page.url();
        return { success: true, sessionId: input.sessionId, action: input.action, title, url };
      }

      case 'get_url': {
        const url = page.url();
        const title = await page.title();
        return { success: true, sessionId: input.sessionId, action: input.action, url, title };
      }

      case 'screenshot': {
        const image = await page.screenshot({
          path: input.screenshotPath,
          fullPage: input.fullPage ?? false,
          type: 'png',
        });

        const state = await getPageState(manager, input.sessionId);

        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
          ...state,
          screenshotPath: input.screenshotPath,
          screenshotBase64: input.screenshotPath ? undefined : image.toString('base64'),
        };
      }

      case 'upload': {
        const selector = requireString(input.selector, 'selector');
        if (!input.filePaths || input.filePaths.length === 0) {
          throw new Error('Field "filePaths" is required for upload action');
        }
        await browser.getLocator(selector).setInputFiles(input.filePaths);
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state };
      }

      case 'tab_list': {
        const tabs = await browser.listTabs();
        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
          tabs,
        };
      }

      case 'tab_new': {
        await browser.newTab();
        const activePage = browser.getPage();
        if (input.url) {
          await activePage.goto(input.url, { waitUntil: input.waitUntil ?? 'domcontentloaded' });
        }
        const tabs = await browser.listTabs();
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state, tabs };
      }

      case 'tab_switch': {
        if (input.tabIndex === undefined) {
          throw new Error('Field "tabIndex" is required for tab_switch');
        }
        await browser.switchTo(input.tabIndex);
        const tabs = await browser.listTabs();
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state, tabs };
      }

      case 'tab_close': {
        await browser.closeTab(input.tabIndex);
        const tabs = await browser.listTabs();
        const state = await getPageState(manager, input.sessionId);
        return { success: true, sessionId: input.sessionId, action: input.action, ...state, tabs };
      }

      case 'start_screencast': {
        await manager.startScreencast(input.sessionId, {
          format: input.screencastFormat,
          quality: input.screencastQuality,
          maxWidth: input.screencastMaxWidth,
          maxHeight: input.screencastMaxHeight,
          everyNthFrame: input.screencastEveryNthFrame,
        });
        const state = await getPageState(manager, input.sessionId);
        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
          ...state,
        };
      }

      case 'stop_screencast': {
        await manager.stopScreencast(input.sessionId);
        const state = await getPageState(manager, input.sessionId);
        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
          ...state,
        };
      }

      case 'close': {
        await manager.closeSession(input.sessionId);
        return {
          success: true,
          sessionId: input.sessionId,
          action: input.action,
        };
      }

      default: {
        const exhaustiveCheck: never = input.action;
        throw new Error(`Unsupported action: ${exhaustiveCheck}`);
      }
    }
  } catch (error) {
    return {
      success: false,
      sessionId: input.sessionId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createBrowserTool(manager: BrowserSessionManager) {
  return async (input: BrowserToolInput): Promise<BrowserToolResult> => browserTool(manager, input);
}
