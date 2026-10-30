// Runs browser actions outside an agent task (run_action) and lists them (list_actions). Both use the same
// Action objects as the agent, so the MCP tools and the agent cannot drift apart.
import { t } from '@extension/i18n';
import { AgentContext, type ActionResult } from '../../agent/types';
import { ActionBuilder, InvalidInputError } from '../../agent/actions/builder';
import type { Action } from '../../agent/actions/action';
import { EventManager } from '../../agent/event/manager';
import MessageManager, { MessageManagerSettings } from '../../agent/messages/service';
import { wrapUntrustedContent, wrapUntrustedOnce } from '../../agent/messages/utils';
import ScopedBrowserContext from '../../browser/scoped-context';
import { isAutomatableWebUrl } from '../../browser/web-page';
import { convertZodToJsonSchema } from '../../utils';
import { browserContext, isAgentBrowserContext } from '../../state/browserSession';
import { runtimeStore } from '../../state/runtimeStore';
import { isAssistantTaskRunning, isCliAgentTaskRunning } from '../../task/taskRunner';
import { driverForMcpClient } from '../../overlay/overlayDriver';
import { hideOverlay, showOverlay } from '../../overlay/overlayMessaging';
import { McpBridgeError, type RunActionParams } from './protocol';

// Task control and host/agent-internal actions make no sense from an MCP client; everything else is a browser action.
const EXCLUDED_ACTIONS: ReadonlySet<string> = new Set([
  'done',
  'ask_user',
  'todo_write',
  'request_user_takeover',
  'list_mcp_tools',
  'call_mcp_tool',
  'list_plugins',
  'call_plugin_tool',
  'save_plugin',
  'shell_exec',
  'fs_read',
  'fs_write',
  'fs_list',
  'fs_search',
]);

// After this long without MCP actions the debugger is released, so Chrome's "is debugging this browser" bar goes away,
// and the page overlay goes with it.
const IDLE_DETACH_MS = 30_000;
let idleDetachTimer: ReturnType<typeof setTimeout> | null = null;
// MCP actions in flight. The timer only runs when none is, so a slow action is never detached mid-way.
let mcpActionsInFlight = 0;

function cancelIdleDetach(): void {
  if (idleDetachTimer) clearTimeout(idleDetachTimer);
  idleDetachTimer = null;
}

function scheduleIdleDetach(): void {
  cancelIdleDetach();
  idleDetachTimer = setTimeout(() => {
    idleDetachTimer = null;
    // A task that started meanwhile owns the browser context and the overlay now; its own end runs the cleanup.
    if (mcpActionsInFlight > 0 || isAssistantTaskRunning() || runtimeStore.getState().currentExecutor) return;
    hideOverlay();
    void browserContext.cleanup().catch(() => {});
  }, IDLE_DETACH_MS);
}

export interface ActionCatalogItem {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RunActionOutcome {
  ok: boolean;
  isDone: boolean;
  extractedContent: string | null;
  error: string | null;
}

function bridgeActions(): Action[] {
  // A fresh context per call: the browser context may have changed since the last call.
  const context = new AgentContext(
    'mcp-bridge',
    browserContext,
    new MessageManager(new MessageManagerSettings({})),
    new EventManager(),
    {},
  );
  return new ActionBuilder(context).buildDefaultActions().filter(action => !EXCLUDED_ACTIONS.has(action.name()));
}

export function listBridgeActions(): { actions: ActionCatalogItem[] } {
  return {
    actions: bridgeActions().map(action => ({
      name: action.name(),
      description: action.schema.description,
      inputSchema: convertZodToJsonSchema(action.schema.schema, action.name()),
    })),
  };
}

/** The overlay names what the client is doing: the action's own intent when it gives one, else the action. */
function overlayStatusFor(params: RunActionParams): string {
  const intent = params.input.intent;
  return typeof intent === 'string' && intent.trim() ? intent.trim() : params.action;
}

function outcomeOf(result: ActionResult): RunActionOutcome {
  // Page content and error text come from the page or the network. Actions already wrap what they return, as the
  // agent expects, so this wraps only what is still bare: the block is never nested.
  return {
    ok: result.error === null,
    isDone: result.isDone,
    extractedContent: result.extractedContent === null ? null : wrapUntrustedOnce(result.extractedContent),
    error: result.error === null ? null : wrapUntrustedOnce(result.error),
  };
}

/**
 * The tab an action without a tabId acts on: the active tab when it is a web page, else the most recently used web
 * page of the focused window, else of any window. Undefined when no web page is open at all.
 */
async function defaultTabId(): Promise<number | undefined> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== undefined && isAutomatableWebUrl(active.url)) return active.id;
  return (
    mostRecentWebTab(await chrome.tabs.query({ lastFocusedWindow: true })) ??
    mostRecentWebTab(await chrome.tabs.query({}))
  );
}

function mostRecentWebTab(tabs: chrome.tabs.Tab[]): number | undefined {
  const webTabs = tabs.filter(tab => tab.id !== undefined && isAutomatableWebUrl(tab.url));
  webTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return webTabs[0]?.id;
}

export async function runBridgeAction(params: RunActionParams): Promise<RunActionOutcome> {
  // The CLI agent of a running CLI task acts through these same calls; only the internal agent owns the page.
  if ((isAssistantTaskRunning() && !isCliAgentTaskRunning()) || runtimeStore.getState().currentExecutor) {
    throw new McpBridgeError('TASK_BUSY', t('bg_task_busy'));
  }
  const action = bridgeActions().find(item => item.name() === params.action);
  if (!action) throw new McpBridgeError('INVALID_PARAMS', `Unknown action: ${params.action}`);
  // The caller's tab, or a web page when the active one is Chrome's own: outside a task the scoped context has no tab.
  const tabId = params.tabId ?? (await defaultTabId());
  if (tabId === undefined) throw new McpBridgeError('TAB_UNAVAILABLE', t('bg_mcp_noActiveTab'));
  if (browserContext instanceof ScopedBrowserContext) browserContext.setAllowedTabs([tabId]);
  mcpActionsInFlight += 1;
  cancelIdleDetach();
  try {
    await browserContext.switchTab(tabId);
    // Shown before the action, so the pointer glides under the overlay; consecutive actions keep it up.
    if (!isAgentBrowserContext(browserContext)) {
      showOverlay(tabId, driverForMcpClient(params.client), overlayStatusFor(params));
    }
    return outcomeOf(await action.call(params.input));
  } catch (error) {
    if (error instanceof InvalidInputError) throw new McpBridgeError('INVALID_PARAMS', error.message);
    if (error instanceof McpBridgeError) throw error;
    // A page or browser failure is the action's result, so the client sees why instead of a generic error.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, isDone: false, extractedContent: null, error: wrapUntrustedContent(message) };
  } finally {
    // Same as the agent after it reads the page: the numbered boxes are for the model, not left on the user's screen.
    await browserContext.removeHighlight().catch(() => {});
    mcpActionsInFlight -= 1;
    if (mcpActionsInFlight === 0) scheduleIdleDetach();
  }
}
