import { ActionApprovalManager } from '../services/action-approval';
import { applyOverlayMode } from '../overlay/overlayMessaging';
import { postToPanel } from '../port/panelPort';
import { browserContext } from '../state/browserSession';

// Single approval queue shared by the executor (authorize) and the side panel (approval_result).
// The glow border switches to the approval color while the agent waits for a decision.
export const actionApprovals = new ActionApprovalManager(message => {
  postToPanel(message);
  if (message.type === 'approval_required') applyOverlayMode(browserContext.currentTabId, 'approval');
  if (message.type === 'approval_resolved') applyOverlayMode(browserContext.currentTabId, 'running');
});
