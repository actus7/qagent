import { useCallback, useState } from 'react';
import type { ActionApproval as Approval } from '@extension/shared';
import type { AgentEvent } from '@src/types/event';

/** Per-task UI state shared by the event handler, approval flow, submission and status bar. */
export const useTaskRunState = () => {
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const resetRunState = useCallback(() => {
    setPendingApproval(null);
    setLastEvent(null);
    setIsPaused(false);
    setIsStopping(false);
  }, []);

  return {
    pendingApproval,
    setPendingApproval,
    lastEvent,
    setLastEvent,
    isPaused,
    setIsPaused,
    isStopping,
    setIsStopping,
    resetRunState,
  };
};

export type TaskRunState = ReturnType<typeof useTaskRunState>;
