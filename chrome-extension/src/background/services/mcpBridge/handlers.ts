import { firewallStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { hasManagedRestrictions, type McpBridgeResponseFrame } from '@extension/shared';
import { isUrlAllowed, sleep } from '../../browser/util';
import { redactUrl } from '../../browser/page-telemetry';
import { addPanelMessageListener } from '../../port/panelPort';
import { routeSidePanelCommand } from '../../port/commandRouter';
import { runtimeStore } from '../../state/runtimeStore';
import { getManagedPolicy } from '../../state/managedPolicyState';
import { cancelActiveTask } from '../../task/taskRunner';
import { loadManagedPolicy } from '../managedPolicy';
import { createTaskCollector, type TaskRunOutcome } from './taskCollector';
import { McpBridgeError, type ParsedBridgeRequest, type RunTaskParams } from './protocol';

const TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_POLL_MS = 250;
// Set while an MCP-started task runs; the panel's own tasks are seen through runtimeStore.
let bridgeTaskId: string | null = null;

/** Same URL rules as the firewall: managed patterns always apply; the firewall lists apply when enabled. */
async function isUrlPermittedForTask(url: string): Promise<boolean> {
  const firewall = await firewallStore.getFirewall();
  const allowList = firewall.enabled ? firewall.allowList : [];
  const denyList = firewall.enabled ? firewall.denyList : [];
  return isUrlAllowed(url, allowList, denyList);
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const deadline = Date.now() + TAB_LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(TAB_POLL_MS);
  }
}

/** Opens the requested URL (or uses the active tab) and returns the tab the task will run on. */
async function resolveTaskTab(url: string | undefined): Promise<number> {
  if (url) {
    if (!(await isUrlPermittedForTask(url))) {
      throw new McpBridgeError('URL_BLOCKED', t('bg_mcp_urlBlocked'));
    }
    const created = await chrome.tabs.create({ url, active: true });
    if (created.id === undefined) throw new McpBridgeError('TAB_UNAVAILABLE', t('bg_mcp_noActiveTab'));
    await waitForTabComplete(created.id);
    return created.id;
  }

  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id === undefined) throw new McpBridgeError('TAB_UNAVAILABLE', t('bg_mcp_noActiveTab'));
  if (!active.url || !(await isUrlPermittedForTask(active.url))) {
    throw new McpBridgeError('URL_BLOCKED', t('bg_mcp_urlBlocked'));
  }
  return active.id;
}

async function runTask(params: RunTaskParams): Promise<TaskRunOutcome & { taskId: string; tabId: number }> {
  if (bridgeTaskId || runtimeStore.getState().currentExecutor) {
    throw new McpBridgeError('TASK_BUSY', t('bg_task_busy'));
  }
  const tabId = await resolveTaskTab(params.url);
  const taskId = crypto.randomUUID();
  const collector = createTaskCollector(taskId);
  const unobserve = addPanelMessageListener(collector.observe);
  bridgeTaskId = taskId;
  try {
    // Same pipeline as the side panel: managed policy checks, then runAssistantTask.
    await routeSidePanelCommand(
      {
        type: 'new_task',
        task: params.task,
        taskId,
        tabId,
        options: {
          mode: params.mode,
          tabIds: [tabId],
          modelAgent: 'navigator',
        },
      },
      () => {},
    );
  } catch (error) {
    throw new McpBridgeError('TASK_START_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    unobserve();
    bridgeTaskId = null;
  }
  return { taskId, tabId, ...collector.result() };
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  const items = [];
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    items.push({
      id: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      title: tab.title ?? '',
      url: redactUrl(tab.url),
      permitted: await isUrlPermittedForTask(tab.url),
    });
  }
  return { tabs: items };
}

function getStatus() {
  const policy = getManagedPolicy();
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    busy: bridgeTaskId !== null || runtimeStore.getState().currentExecutor !== null,
    sidePanelConnected: runtimeStore.getState().currentPort !== null,
    managedRestrictions: hasManagedRestrictions(policy),
  };
}

/** Executes one validated bridge request. Only the normal task pipeline can start work. */
export async function handleBridgeRequest(request: ParsedBridgeRequest): Promise<unknown> {
  switch (request.method) {
    case 'run_task':
      await loadManagedPolicy();
      return runTask(request.params);
    case 'list_tabs':
      return listTabs();
    case 'get_status':
      return getStatus();
    case 'cancel_task':
      await cancelActiveTask();
      return { cancelled: true };
  }
}

/** Builds the response frame for a handler outcome. Internal error details are not exposed to the bridge. */
export function toBridgeResponse(id: string, outcome: { ok: true; result: unknown } | { ok: false; error: unknown }): McpBridgeResponseFrame {
  if (outcome.ok) return { type: 'response', id, ok: true, result: outcome.result };
  if (outcome.error instanceof McpBridgeError) {
    return { type: 'response', id, ok: false, error: { code: outcome.error.code, message: outcome.error.message } };
  }
  return { type: 'response', id, ok: false, error: { code: 'INTERNAL', message: t('bg_mcp_internalError') } };
}
