import type { AgentContext } from '@src/background/agent/types';
import { createDoneAction } from './completion';
import {
  createBackAction,
  createForwardAction,
  createGoBackAction,
  createGoToUrlAction,
  createOpenAction,
  createReloadAction,
  createSearchGoogleAction,
  createWaitAction,
} from './navigation';
import {
  createClickAction,
  createClickElementAction,
  createFillAction,
  createGetDropdownOptionsAction,
  createInputTextAction,
  createUploadFileAction,
  createPressAction,
  createSelectDropdownOptionAction,
  createSendKeysAction,
  createTypeAction,
} from './interaction';
import {
  createNextPageAction,
  createPreviousPageAction,
  createScrollAction,
  createScrollIntoViewAction,
  createScrollToBottomAction,
  createScrollToPercentAction,
  createScrollToTextAction,
  createScrollToTopAction,
} from './scroll';
import {
  createCacheContentAction,
  createGetTextAction,
  createGetTitleAction,
  createGetUrlAction,
  createSnapshotAction,
} from './content';
import { createCloseTabAction, createOpenTabAction, createSwitchTabAction } from './tabs';
import {
  createExecuteJavascriptAction,
  createReadConsoleMessagesAction,
  createReadNetworkRequestsAction,
  createResizeViewportAction,
} from './inspection';
import { createClickAtAction, createDragAction, createHoverAction } from './pointer';
import {
  createFindProgressAction,
  createPageInfoAction,
  createSwitchFrameAction,
  createHandleDialogAction,
  createReadAccessibilityTreeAction,
  createWaitForElementAction,
} from './page-tools';
import { createRequestUserTakeoverAction } from './takeover';
import { createCallPluginToolAction, createListPluginsAction, createSavePluginAction } from './plugins';
import { createCallMcpToolAction, createListMcpToolsAction } from './mcp';
import { createWebFetchAction } from './web-fetch';
import { createAskUserAction } from './ask-user';
import { createTodoWriteAction } from './todo';
import { createScreenshotAction, createReadThemeAction, createAuditContrastAction } from './visual';
import { createCaptureDownloadAction, createListDownloadsAction } from './downloads';
import { createListSiteToolsAction, createCallSiteToolAction } from './site-tools';
import { createFindCaptchaAction, createSolveCaptchaAction } from './captcha';
import {
  createAwaitMonitorAction,
  createMonitorStatusAction,
  createStartMonitorAction,
  createStopMonitorAction,
} from './monitor';
import {
  createFsListAction,
  createFsReadAction,
  createFsSearchAction,
  createFsWriteAction,
  createShellExecAction,
} from './host';

import type { Action } from './action';
import { createMapSiteAction } from './site-map';
import { createRunWorkflowAction } from './workflow';

export { Action, InvalidInputError, buildDynamicActionSchema } from './action';

const AGENT_BROWSER_V1_ALLOWED_ACTIONS = new Set([
  'done',
  'search_google',
  'open',
  'go_to_url',
  'back',
  'go_back',
  'forward',
  'reload',
  'wait',
  'click',
  'click_element',
  'fill',
  'type',
  'input_text',
  'press',
  'send_keys',
  'get_text',
  'get_title',
  'get_url',
  'snapshot',
  'cache_content',
]);

// Needs chrome.debugger (CDP input, console and network telemetry, full-page capture, captcha frames) or is not
// implemented by the content-script engine. Removed from the list there, as AGENT_BROWSER_V1_ALLOWED_ACTIONS does.
const CONTENT_SCRIPT_UNSUPPORTED_ACTIONS = new Set([
  'click_at',
  'hover',
  'drag',
  'read_console_messages',
  'read_network_requests',
  'resize_viewport',
  'screenshot',
  'read_theme',
  'audit_contrast',
  'page_info',
  'find_progress',
  'wait_for_element',
  'switch_frame',
  'read_accessibility_tree',
  'list_site_tools',
  'call_site_tool',
  'find_captcha',
  'solve_captcha',
]);

export class ActionBuilder {
  private readonly context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  // The order of this list is part of the prompt contract: do not reorder without updating the order-guard test.
  buildDefaultActions() {
    const context = this.context;
    // Typed up front: run_workflow looks its sibling actions up in this same list, which would otherwise be circular.
    const actions: Action[] = [
      createDoneAction(context),
      createSearchGoogleAction(context),
      createOpenAction(context),
      createGoToUrlAction(context),
      createBackAction(context),
      createGoBackAction(context),
      createForwardAction(context),
      createReloadAction(context),
      createWaitAction(context),
      createClickAction(context),
      createClickElementAction(context),
      createFillAction(context),
      createTypeAction(context),
      createInputTextAction(context),
      createPressAction(context),
      createScrollAction(context),
      createScrollIntoViewAction(context),
      createGetTextAction(context),
      createGetTitleAction(context),
      createGetUrlAction(context),
      createSnapshotAction(context),
      createSwitchTabAction(context),
      createOpenTabAction(context),
      createCloseTabAction(context),
      createCacheContentAction(context),
      createScrollToPercentAction(context),
      createScrollToTopAction(context),
      createScrollToBottomAction(context),
      createPreviousPageAction(context),
      createNextPageAction(context),
      createScrollToTextAction(context),
      createSendKeysAction(context),
      createGetDropdownOptionsAction(context),
      createSelectDropdownOptionAction(context),
      createUploadFileAction(context),
      createReadConsoleMessagesAction(context),
      createReadNetworkRequestsAction(context),
      createExecuteJavascriptAction(context),
      createClickAtAction(context),
      createHoverAction(context),
      createDragAction(context),
      createPageInfoAction(context),
      createFindProgressAction(context),
      createWaitForElementAction(context),
      createSwitchFrameAction(context),
      createHandleDialogAction(context),
      createReadAccessibilityTreeAction(context),
      createResizeViewportAction(context),
      createRequestUserTakeoverAction(context),
      createListPluginsAction(context),
      createCallPluginToolAction(context),
      createSavePluginAction(context),
      createListMcpToolsAction(context),
      createCallMcpToolAction(context),
      createWebFetchAction(context),
      createAskUserAction(context),
      createTodoWriteAction(context),
      createScreenshotAction(context),
      createReadThemeAction(context),
      createAuditContrastAction(context),
      createCaptureDownloadAction(context),
      createListDownloadsAction(context),
      createListSiteToolsAction(context),
      createCallSiteToolAction(context),
      createFindCaptchaAction(context),
      createSolveCaptchaAction(context),
      createStartMonitorAction(context),
      createMonitorStatusAction(context),
      createAwaitMonitorAction(context),
      createStopMonitorAction(context),
      createShellExecAction(context),
      createFsReadAction(context),
      createFsWriteAction(context),
      createFsListAction(context),
      createFsSearchAction(context),
      createMapSiteAction(context),
      createRunWorkflowAction(context, name => actions.find(action => action.name() === name)),
    ];
    const engine = this.context.browserContext.getEngineName();
    if (engine === 'agent-browser-v1') {
      return actions.filter(action => AGENT_BROWSER_V1_ALLOWED_ACTIONS.has(action.name()));
    }
    if (engine === 'content-script') {
      return actions.filter(action => !CONTENT_SCRIPT_UNSUPPORTED_ACTIONS.has(action.name()));
    }
    return actions;
  }
}
