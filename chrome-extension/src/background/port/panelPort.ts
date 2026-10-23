import type { SidePanelResponseMessage } from '@extension/shared';
import { runtimeStore } from '../state/runtimeStore';

type PanelMessageListener = (message: SidePanelResponseMessage) => void;

// In-process observers (e.g. the MCP bridge collecting a task's answer). They see every message, panel connected or not.
const listeners = new Set<PanelMessageListener>();

export function addPanelMessageListener(listener: PanelMessageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Sends to the currently connected side panel. Drops silently when no panel is connected.
export function postToPanel(message: SidePanelResponseMessage): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      /* A failing observer must not affect the panel or the task. */
    }
  }
  try {
    runtimeStore.getState().currentPort?.postMessage(message);
  } catch {
    /* The panel may close while a cancelled request is settling. */
  }
}
