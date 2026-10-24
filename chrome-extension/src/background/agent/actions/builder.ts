import { isManagedActionAllowed } from '@extension/shared';
import type { AgentContext } from '@src/background/agent/types';
import { getManagedPolicy } from '@src/background/state/managedPolicyState';
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
import { createRequestUserTakeoverAction } from './takeover';

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

export class ActionBuilder {
  private readonly context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  // The order of this list is part of the prompt contract: do not reorder without updating the order-guard test.
  buildDefaultActions() {
    const context = this.context;
    const actions = [
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
      createResizeViewportAction(context),
      createRequestUserTakeoverAction(context),
    ];
    // Managed policy removes actions here, so the model never sees them (order is preserved).
    const policy = getManagedPolicy();
    const permittedActions = actions.filter(action => isManagedActionAllowed(action.name(), policy));

    if (this.context.browserContext.getEngineName() === 'agent-browser-v1') {
      return permittedActions.filter(action => AGENT_BROWSER_V1_ALLOWED_ACTIONS.has(action.name()));
    }
    return permittedActions;
  }
}
