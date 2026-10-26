// Runs browser actions outside an agent task (run_action) and lists them (list_actions). Both use the same
// Action objects as the agent, so the MCP tools and the agent cannot drift apart.
import { t } from '@extension/i18n';
import { AgentContext, type ActionResult } from '../../agent/types';
import { ActionBuilder, InvalidInputError } from '../../agent/actions/builder';
import type { Action } from '../../agent/actions/action';
import { EventManager } from '../../agent/event/manager';
import MessageManager, { MessageManagerSettings } from '../../agent/messages/service';
import { wrapUntrustedContent } from '../../agent/messages/utils';
import ScopedBrowserContext from '../../browser/scoped-context';
import { convertZodToJsonSchema } from '../../utils';
import { browserContext } from '../../state/browserSession';
import { runtimeStore } from '../../state/runtimeStore';
import { isAssistantTaskRunning } from '../../task/taskRunner';
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

function outcomeOf(result: ActionResult): RunActionOutcome {
  // Page content and error text come from the page or the network: wrapped before they reach the model.
  return {
    ok: result.error === null,
    isDone: result.isDone,
    extractedContent: result.extractedContent === null ? null : wrapUntrustedContent(result.extractedContent),
    error: result.error === null ? null : wrapUntrustedContent(result.error),
  };
}

export async function runBridgeAction(params: RunActionParams): Promise<RunActionOutcome> {
  if (isAssistantTaskRunning() || runtimeStore.getState().currentExecutor) {
    throw new McpBridgeError('TASK_BUSY', t('bg_task_busy'));
  }
  const action = bridgeActions().find(item => item.name() === params.action);
  if (!action) throw new McpBridgeError('INVALID_PARAMS', `Unknown action: ${params.action}`);
  // The caller's tab, or the active one: outside a task the scoped context has no tab of its own.
  const tabId = params.tabId ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (tabId === undefined) throw new McpBridgeError('TAB_UNAVAILABLE', t('bg_mcp_noActiveTab'));
  if (browserContext instanceof ScopedBrowserContext) browserContext.setAllowedTabs([tabId]);
  try {
    await browserContext.switchTab(tabId);
    return outcomeOf(await action.call(params.input));
  } catch (error) {
    if (error instanceof InvalidInputError) throw new McpBridgeError('INVALID_PARAMS', error.message);
    if (error instanceof McpBridgeError) throw error;
    // A page or browser failure is the action's result, so the client sees why instead of a generic error.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, isDone: false, extractedContent: null, error: wrapUntrustedContent(message) };
  }
}
