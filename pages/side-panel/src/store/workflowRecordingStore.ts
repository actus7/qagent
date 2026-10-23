import { useSyncExternalStore } from 'react';
import type { WorkflowRecordingSnapshot } from '@extension/shared';

// The connection hook publishes every background snapshot here; components subscribe with useSyncExternalStore.
const IDLE_SNAPSHOT: WorkflowRecordingSnapshot = { status: 'idle', tabId: null, steps: [], truncated: false };

let snapshot: WorkflowRecordingSnapshot = IDLE_SNAPSHOT;
const listeners = new Set<() => void>();

export function publishWorkflowRecording(next: WorkflowRecordingSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkflowRecordingSnapshot(): WorkflowRecordingSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
