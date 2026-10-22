import { FiMessageSquare, FiList, FiZap } from 'react-icons/fi';
import type { AssistantMode } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';

interface ModeBarProps {
  copy: ReturnType<typeof assistantCopy>;
  mode: AssistantMode;
  disabled: boolean;
  onModeChange: (mode: AssistantMode) => void;
}

export default function ModeBar({ copy, mode, disabled, onModeChange }: ModeBarProps) {
  const items = [
    { mode: 'chat' as const, label: copy.chat, hint: copy.chatHint, icon: FiMessageSquare },
    { mode: 'plan' as const, label: copy.plan, hint: copy.planHint, icon: FiList },
    { mode: 'act' as const, label: copy.act, hint: copy.actHint, icon: FiZap },
  ];

  return (
    <nav className="assistant-mode-bar" aria-label="QAgent">
      {items.map(item => (
        <button
          key={item.mode}
          type="button"
          aria-pressed={mode === item.mode}
          title={item.hint}
          disabled={disabled}
          onClick={() => onModeChange(item.mode)}>
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
    </nav>
  );
}
