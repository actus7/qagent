import { FiPause, FiPlay } from 'react-icons/fi';
import type { AssistantMode } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';
import type { AgentEvent } from '../types/event';

interface TaskStatusBarProps {
  copy: ReturnType<typeof assistantCopy>;
  mode: AssistantMode;
  isPaused: boolean;
  isStopping: boolean;
  hasPendingApproval: boolean;
  lastEvent: AgentEvent | null;
  onTogglePause: () => void;
}

export default function TaskStatusBar({
  copy,
  mode,
  isPaused,
  isStopping,
  hasPendingApproval,
  lastEvent,
  onTogglePause,
}: TaskStatusBarProps) {
  const stepLabel =
    lastEvent && lastEvent.data.maxSteps > 0
      ? `${Math.min(lastEvent.data.step + 1, lastEvent.data.maxSteps)}/${lastEvent.data.maxSteps}`
      : null;
  const canPause = mode === 'act' && !isStopping && !hasPendingApproval;

  return (
    <div className="assistant-task-status" role="status">
      <span className={isPaused ? 'assistant-status-dot' : 'assistant-loading-dot'} />
      <div>
        <strong>{isStopping ? copy.stopping : isPaused ? copy.paused : copy.working}</strong>
        <span>{lastEvent?.data.details || (mode === 'act' ? copy.actHint : copy.readOnly)}</span>
      </div>
      {stepLabel ? <small>{stepLabel}</small> : null}
      {canPause ? (
        <button
          type="button"
          title={isPaused ? copy.resume : copy.pause}
          aria-label={isPaused ? copy.resume : copy.pause}
          onClick={onTogglePause}>
          {isPaused ? <FiPlay /> : <FiPause />}
        </button>
      ) : null}
    </div>
  );
}
