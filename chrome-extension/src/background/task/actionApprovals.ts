import { ActionApprovalManager } from '../services/action-approval';
import { postToPanel } from '../port/panelPort';

// Single approval queue shared by the executor (authorize) and the side panel (approval_result).
export const actionApprovals = new ActionApprovalManager(postToPanel);
