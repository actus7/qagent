import 'webextension-polyfill';
import { createLogger } from './log';
import { browserEngine } from './state/browserSession';
import { registerTabListeners } from './listeners/tabs';
import { registerDebuggerListener } from './listeners/debugger';
import { registerRuntimeMessageListener } from './listeners/runtimeMessages';
import { registerSidePanelPortListener, setupSidePanelBehavior } from './port/sidePanelPort';
import { registerPanelForwarders } from './port/panelForwarding';
import { registerSettingsSync } from './services/settingsSync';
import { registerContextMenu } from './services/context-menu';
import { loadManagedPolicy, registerManagedPolicyListener } from './services/managedPolicy';
import { registerMcpBridge } from './services/mcpBridge/client';

// Service-worker composition root. Chrome requires listeners to be registered synchronously at
// top level, so every register* call below runs during evaluation, never inside an async callback.
const logger = createLogger('background');

setupSidePanelBehavior();
registerTabListeners();
registerDebuggerListener();

logger.info('background loaded');
logger.info('browser engine', browserEngine);

registerPanelForwarders();
registerSettingsSync();
registerRuntimeMessageListener();
registerSidePanelPortListener();
registerContextMenu();
registerManagedPolicyListener();
void loadManagedPolicy();
registerMcpBridge();
