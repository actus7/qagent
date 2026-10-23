import type { SidePanelResponseMessage } from '@extension/shared';
import { runtimeStore } from '../state/runtimeStore';
import { notifyTaskAttention } from '../services/task-notifications';

// Sends to the currently connected side panel. Drops silently when no panel is connected.
export function postToPanel(message: SidePanelResponseMessage): void {
  // An approval that nobody can see would stall the task; notify when no panel is connected (the check is inside).
  if (message.type === 'approval_required') void notifyTaskAttention('approval_required', '');
  try {
    runtimeStore.getState().currentPort?.postMessage(message);
  } catch {
    /* The panel may close while a cancelled request is settling. */
  }
}
