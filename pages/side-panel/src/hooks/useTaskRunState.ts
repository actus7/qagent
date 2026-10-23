import { useCallback, useState } from 'react';
import type { ActionApproval as Approval } from '@extension/shared';
import type { AgentEvent } from '@src/types/event';

/** Control handed to the user: requested by the agent (request_user_takeover) or taken by the user. */
export interface TakeoverState {
  source: 'agent' | 'user';
  message: string;
}

/** Per-task UI state shared by the event handler, approval flow, submission and status bar. */
export const useTaskRunState = () => {
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [takeover, setTakeover] = useState<TakeoverState | null>(null);

  const resetRunState = useCallback(() => {
    setPendingApproval(null);
    setLastEvent(null);
    setIsPaused(false);
    setIsStopping(false);
    setTakeover(null);
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
    takeover,
    setTakeover,
    resetRunState,
  };
};

export type TaskRunState = ReturnType<typeof useTaskRunState>;
