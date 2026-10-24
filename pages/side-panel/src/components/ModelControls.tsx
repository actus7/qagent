import { useEffect, useRef, useState } from 'react';
import { FiCheck, FiChevronUp } from 'react-icons/fi';
import type { AssistantWorkspace } from '../hooks/useAssistantWorkspace';
import type { assistantCopy } from '../lib/assistant-copy';

interface ModelControlsProps {
  copy: ReturnType<typeof assistantCopy>;
  workspace: AssistantWorkspace;
  showStopButton: boolean;
}

export default function ModelControls({ copy, workspace, showStopButton }: ModelControlsProps) {
  const { modelAgent, setModelAgent, models } = workspace;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canChooseModel = models.length > 1;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const modelLabel = models.find(model => model.agent === modelAgent)?.label ?? copy.model;

  return (
    <div className="assistant-composer-settings" ref={rootRef}>
      <button
        type="button"
        className="assistant-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={modelLabel}
        disabled={showStopButton || !canChooseModel}
        onClick={() => setOpen(value => !value)}>
        <span className="assistant-menu-labels">
          <span className="assistant-menu-model">{modelLabel}</span>
        </span>
        {canChooseModel ? <FiChevronUp size={12} className="assistant-menu-chevron" data-open={open} /> : null}
      </button>
      {open && canChooseModel ? (
        <div className="assistant-menu" role="menu">
          <div className="assistant-menu-heading">{copy.model}</div>
          {models.map(model => (
            <MenuItem
              key={model.agent}
              label={model.label}
              selected={model.agent === modelAgent}
              onSelect={() => setModelAgent(model.agent)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface MenuItemProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
}

function MenuItem({ label, selected, onSelect }: MenuItemProps) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} onClick={onSelect}>
      <span>{label}</span>
      {selected ? <FiCheck size={14} /> : null}
    </button>
  );
}
