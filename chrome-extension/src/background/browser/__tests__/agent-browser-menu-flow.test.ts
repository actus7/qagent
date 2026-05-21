import { describe, expect, it, vi } from 'vitest';
import type { AgentBrowserCompanionClient } from '../agent-browser/client';
import AgentBrowserContext from '../agent-browser/context';
import AgentBrowserPage from '../agent-browser/page';
import type { CompanionAction, CompanionRpcResponse, RefMap } from '../agent-browser/protocol';
import { DEFAULT_BROWSER_CONTEXT_CONFIG } from '../views';

interface MenuItem {
  key: string;
  selector: string;
  label: string;
  hash: string;
}

const BASE_URL = 'https://www.ideal.dev.br';
const PAGE_TITLE = 'IdealDev - Sistemas de Informacao';

const MENU_ITEMS: MenuItem[] = [
  { key: 'e1', selector: '@e1', label: 'Principal', hash: '#principal' },
  { key: 'e2', selector: '@e2', label: 'Sobre', hash: '#sobre' },
  { key: 'e3', selector: '@e3', label: 'Servicos', hash: '#servicos' },
  { key: 'e4', selector: '@e4', label: 'Portfolio', hash: '#portfolio' },
  { key: 'e5', selector: '@e5', label: 'Diferenciais', hash: '#diferenciais' },
  { key: 'e6', selector: '@e6', label: 'Contato', hash: '#contato' },
];

function buildStateUrl(hash: string): string {
  return `${BASE_URL}/${hash}`;
}

function buildMenuSnapshot(activeSelector: string): string {
  return MENU_ITEMS.map(item => {
    const isActive = item.selector === activeSelector;
    const label = isActive ? `${item.label} (active)` : item.label;
    return `- link "${label}" [ref=${item.key}]`;
  }).join('\n');
}

function buildMenuRefs(activeSelector: string): RefMap {
  const refs: RefMap = {};

  for (const item of MENU_ITEMS) {
    const isActive = item.selector === activeSelector;
    refs[item.key] = {
      selector: item.selector,
      role: 'link',
      name: isActive ? `${item.label} (active)` : item.label,
    };
  }

  return refs;
}

function successResponse(action: string, data: Record<string, unknown>): CompanionRpcResponse {
  return {
    type: 'rpc_response',
    id: `mock-${action}`,
    success: true,
    data: {
      success: true,
      sessionId: 'menu-session',
      action,
      ...data,
    },
  };
}

describe('AgentBrowser menu flow', () => {
  it('navigates menu sections via refs and keeps screenshot evidence in state', async () => {
    let activeHash = MENU_ITEMS[0].hash;
    let activeSelector = MENU_ITEMS[0].selector;
    let screenshotCounter = 0;

    const request = vi.fn(
      async (_sessionId: string, _taskId: string, action: CompanionAction): Promise<CompanionRpcResponse> => {
        switch (action.action) {
          case 'open':
            activeHash = MENU_ITEMS[0].hash;
            activeSelector = MENU_ITEMS[0].selector;
            return successResponse('open', {
              url: action.url,
              title: PAGE_TITLE,
            });
          case 'click': {
            const menuItem = MENU_ITEMS.find(item => item.selector === action.selector);
            if (!menuItem) {
              throw new Error(`Unexpected menu selector in click action: ${action.selector}`);
            }
            activeHash = menuItem.hash;
            activeSelector = menuItem.selector;
            return successResponse('click', {
              url: buildStateUrl(activeHash),
              title: PAGE_TITLE,
            });
          }
          case 'snapshot':
            return successResponse('snapshot', {
              url: buildStateUrl(activeHash),
              title: PAGE_TITLE,
              snapshotTree: buildMenuSnapshot(activeSelector),
              refs: buildMenuRefs(activeSelector),
            });
          case 'screenshot':
            screenshotCounter += 1;
            return successResponse('screenshot', {
              screenshotBase64: `menu-screenshot-${screenshotCounter}`,
            });
          case 'tab_list':
            return successResponse('tab_list', {
              tabs: [
                {
                  index: 0,
                  url: buildStateUrl(activeHash),
                  title: PAGE_TITLE,
                  active: true,
                },
              ],
            });
          case 'close':
            return successResponse('close', {});
          default:
            throw new Error(`Unexpected action in menu test: ${action.action}`);
        }
      },
    );

    const companionClient = {
      request,
      sendInput: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentBrowserCompanionClient;

    const context = new AgentBrowserContext({}, companionClient);
    context.setSessionId('menu-session');

    await context.navigateTo(BASE_URL);
    const page = await context.getCurrentPage();

    for (const item of MENU_ITEMS) {
      await page.clickBySelector(true, item.selector);
      const state = await context.getState(true);

      expect(state.url).toBe(buildStateUrl(item.hash));
      expect(state.screenshot).toBeTruthy();

      const index = Number.parseInt(item.key.slice(1), 10);
      const activeNode = state.selectorMap.get(index);
      expect(activeNode).not.toBeNull();
      expect(activeNode?.getAllTextTillNextClickableElement()).toContain('(active)');
    }

    const clickSelectors = request.mock.calls
      .map(call => call[2] as CompanionAction)
      .filter((action): action is Extract<CompanionAction, { action: 'click' }> => action.action === 'click')
      .map(action => action.selector);

    expect(clickSelectors).toEqual(MENU_ITEMS.map(item => item.selector));
    expect(screenshotCounter).toBe(MENU_ITEMS.length + 1);
  });

  it('builds menu selector map from snapshot when refs are missing', async () => {
    const request = vi.fn(
      async (_sessionId: string, _taskId: string, action: CompanionAction): Promise<CompanionRpcResponse> => {
        switch (action.action) {
          case 'snapshot':
            return successResponse('snapshot', {
              url: buildStateUrl('#sobre'),
              title: PAGE_TITLE,
              snapshotTree: buildMenuSnapshot('@e2'),
              refs: {},
            });
          case 'screenshot':
            return successResponse('screenshot', {
              screenshotBase64: 'menu-screenshot-fallback',
            });
          case 'close':
            return successResponse('close', {});
          default:
            throw new Error(`Unexpected action in snapshot fallback test: ${action.action}`);
        }
      },
    );

    const page = new AgentBrowserPage({
      tabIdProvider: () => 1,
      sessionIdProvider: () => 'menu-session',
      taskIdProvider: () => 'menu-task',
      getConfig: () => DEFAULT_BROWSER_CONTEXT_CONFIG,
      client: {
        request,
        sendInput: vi.fn().mockResolvedValue(undefined),
      } as unknown as AgentBrowserCompanionClient,
    });

    const state = await page.getState(true);

    expect(state.selectorMap.size).toBe(MENU_ITEMS.length);
    expect(state.screenshot).toBe('menu-screenshot-fallback');

    const sobreNode = state.selectorMap.get(2);
    expect(sobreNode).not.toBeNull();
    expect(sobreNode?.attributes['data-selector']).toBe('@e2');
    expect(sobreNode?.getAllTextTillNextClickableElement()).toContain('Sobre (active)');
  });
});
