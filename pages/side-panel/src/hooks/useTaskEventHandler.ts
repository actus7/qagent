import { useCallback, type MutableRefObject } from 'react';
import { Actors } from '@extension/storage';
import { ExecutionState, type AgentEvent } from '@src/types/event';
import { formatDebugEvent, planTaskDisplay, type AppendMessage } from '../lib/sidepanel-events';
import type { TaskRunState } from './useTaskRunState';
import { useSidePanelActions } from './useSidePanelSelectors';

interface UseTaskEventHandlerArgs {
  appendMessage: AppendMessage;
  sessionIdRef: MutableRefObject<string | null>;
  chatDebugMode: boolean;
  progressMessage: string;
  runState: TaskRunState;
}

const TERMINAL_TASK_STATES: ExecutionState[] = [
  ExecutionState.TASK_OK,
  ExecutionState.TASK_FAIL,
  ExecutionState.TASK_CANCEL,
];

/** Applies the UI state changes triggered by a task-level (SYSTEM actor) event. */
const useSystemStateEffects = () => {
  const { setIsHistoricalSession, setIsFollowUpMode, setInputEnabled, setShowStopButton, setIsReplaying } =
    useSidePanelActions();

  return useCallback(
    (state: ExecutionState) => {
      switch (state) {
        case ExecutionState.TASK_START:
          // Reset historical session flag when a new task starts
          setIsHistoricalSession(false);
          break;
        case ExecutionState.TASK_OK:
        case ExecutionState.TASK_FAIL:
          setIsFollowUpMode(true);
          setInputEnabled(true);
          setShowStopButton(false);
          setIsReplaying(false);
          break;
        case ExecutionState.TASK_CANCEL:
          setIsFollowUpMode(false);
          setInputEnabled(true);
          setShowStopButton(false);
          setIsReplaying(false);
          break;
        case ExecutionState.TASK_PAUSE:
          setIsReplaying(false);
          break;
        default:
          break;
      }
    },
    [setIsFollowUpMode, setIsHistoricalSession, setInputEnabled, setIsReplaying, setShowStopButton],
  );
};

/** Turns execution events from the background into chat messages and task UI state. */
export const useTaskEventHandler = ({
  appendMessage,
  sessionIdRef,
  chatDebugMode,
  progressMessage,
  runState,
}: UseTaskEventHandlerArgs) => {
  const { setMessages } = useSidePanelActions();
  const applySystemState = useSystemStateEffects();
  const { setLastEvent, setPendingApproval, setIsStopping, setIsPaused, setTakeover } = runState;

  return useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      if (data?.taskId !== sessionIdRef.current) return;
      setLastEvent(event);
      if (TERMINAL_TASK_STATES.includes(state)) {
        setPendingApproval(null);
        setIsStopping(false);
        setIsPaused(false);
        setTakeover(null);
        setMessages(previous => previous.filter(item => item.content !== progressMessage));
      }
      // The background is the source of truth for pause state; the local toggle is only optimistic
      if (state === ExecutionState.TASK_PAUSE) setIsPaused(true);
      if (state === ExecutionState.TASK_RESUME) setIsPaused(false);
      if (state === ExecutionState.TASK_PAUSE && data?.takeover) {
        setTakeover({ source: 'agent', message: data.takeover.message });
      }
      if (state === ExecutionState.TASK_RESUME) setTakeover(null);

      const content = data?.details;
      const plan = planTaskDisplay(actor, state, content);
      if (!plan.ok) {
        console.error(plan.error, plan.detail);
        return;
      }
      if (actor === Actors.SYSTEM) applySystemState(state);

      if (!plan.skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
          kind: actor === Actors.SYSTEM ? undefined : 'activity',
        });
      }

      if (plan.displayProgress) {
        appendMessage({
          actor,
          content: progressMessage,
          timestamp: timestamp,
        });
      }

      if (chatDebugMode) {
        appendMessage({
          actor,
          content: formatDebugEvent(event),
          timestamp: timestamp,
        });
      }
    },
    [
      appendMessage,
      applySystemState,
      chatDebugMode,
      progressMessage,
      sessionIdRef,
      setIsPaused,
      setIsStopping,
      setLastEvent,
      setMessages,
      setPendingApproval,
      setTakeover,
    ],
  );
};
