import { useEffect, useRef, useState } from 'react';
import { FiCheck, FiChevronUp } from 'react-icons/fi';
import type { PermissionMode } from '@extension/shared';
import type { AssistantWorkspace } from '../hooks/useAssistantWorkspace';
import { useManagedPolicy } from '../hooks/useManagedPolicy';
import type { assistantCopy } from '../lib/assistant-copy';

interface ModelControlsProps {
  copy: ReturnType<typeof assistantCopy>;
  workspace: AssistantWorkspace;
  showStopButton: boolean;
}

export default function ModelControls({ copy, workspace, showStopButton }: ModelControlsProps) {
  const { policy } = useManagedPolicy();
  const autoForbidden = policy.disableAutoMode;
  const { permissionMode, setPermissionMode, modelAgent, setModelAgent, models } = workspace;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Managed policy forbids auto mode: fall back to asking. The background enforces this too.
  useEffect(() => {
    if (autoForbidden && permissionMode === 'auto') setPermissionMode('ask');
  }, [autoForbidden, permissionMode, setPermissionMode]);

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

  const permissions: { value: PermissionMode; label: string; disabled?: boolean }[] = [
    { value: 'ask', label: copy.ask },
    { value: 'auto', label: copy.auto, disabled: autoForbidden },
    { value: 'plan', label: copy.permissionPlan },
  ];
  const modelLabel = models.find(model => model.agent === modelAgent)?.label ?? copy.model;
  const permissionLabel = permissions.find(item => item.value === permissionMode)?.label ?? '';

  return (
    <div className="assistant-composer-settings" ref={rootRef}>
      <button
        type="button"
        className="assistant-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={showStopButton}
        onClick={() => setOpen(value => !value)}>
        <span className="assistant-menu-model">{modelLabel}</span>
        <span className="assistant-menu-sub">{permissionLabel}</span>
        <FiChevronUp size={12} className="assistant-menu-chevron" data-open={open} />
      </button>
      {open ? (
        <div className="assistant-menu" role="menu">
          {models.length > 1 ? (
            <>
              <div className="assistant-menu-heading">{copy.model}</div>
              {models.map(model => (
                <MenuItem
                  key={model.agent}
                  label={model.label}
                  selected={model.agent === modelAgent}
                  onSelect={() => setModelAgent(model.agent)}
                />
              ))}
              <div className="assistant-menu-divider" />
            </>
          ) : null}
          <div className="assistant-menu-heading">{copy.permissions}</div>
          {permissions.map(item => (
            <MenuItem
              key={item.value}
              label={item.label}
              selected={item.value === permissionMode}
              disabled={item.disabled}
              onSelect={() => {
                setPermissionMode(item.value);
                setOpen(false);
              }}
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
  disabled?: boolean;
  onSelect: () => void;
}

function MenuItem({ label, selected, disabled, onSelect }: MenuItemProps) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} disabled={disabled} onClick={onSelect}>
      <span>{label}</span>
      {selected ? <FiCheck size={14} /> : null}
    </button>
  );
}
