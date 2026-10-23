import type { assistantCopy } from '../lib/assistant-copy';
import type { TakeoverState } from '../hooks/useTaskRunState';

interface TakeoverBannerProps {
  copy: ReturnType<typeof assistantCopy>;
  takeover: TakeoverState;
  onReturnToAgent: () => void;
}

/** Shown while the task waits for the user: either the agent asked for help or the user took over. */
export default function TakeoverBanner({ copy, takeover, onReturnToAgent }: TakeoverBannerProps) {
  const isAgentRequest = takeover.source === 'agent';
  const title = isAgentRequest ? `${copy.takeoverTitle}: ${takeover.message}` : copy.takeoverUserTitle;

  return (
    <div role="alert" className="mx-3 mb-2 flex items-center gap-3 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3">
      <div className="min-w-0 flex-1">
        <strong className="block text-sm wrap-break-word">{title}</strong>
        {isAgentRequest ? null : <span className="text-xs text-muted-foreground">{copy.takeoverUserBody}</span>}
      </div>
      <button
        type="button"
        onClick={onReturnToAgent}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90">
        {copy.returnToAgent}
      </button>
    </div>
  );
}
