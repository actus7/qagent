import type { SidePanelResponseMessage } from '@extension/shared';
import { runtimeStore } from '../state/runtimeStore';

// Sends to the currently connected side panel. Drops silently when no panel is connected.
export function postToPanel(message: SidePanelResponseMessage): void {
  try {
    runtimeStore.getState().currentPort?.postMessage(message);
  } catch {
    /* The panel may close while a cancelled request is settling. */
  }
}
