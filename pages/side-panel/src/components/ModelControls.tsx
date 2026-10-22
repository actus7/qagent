import { FiChevronDown } from 'react-icons/fi';
import type { AssistantWorkspace } from '../hooks/useAssistantWorkspace';
import type { assistantCopy } from '../lib/assistant-copy';

interface ModelControlsProps {
  copy: ReturnType<typeof assistantCopy>;
  workspace: AssistantWorkspace;
  showStopButton: boolean;
}

export default function ModelControls({ copy, workspace, showStopButton }: ModelControlsProps) {
  return (
    <div className="assistant-composer-settings">
      <label className="assistant-model-select">
        <span className="sr-only">{copy.model}</span>
        <select
          aria-label={copy.model}
          value={workspace.modelAgent}
          disabled={showStopButton || workspace.models.length === 0}
          onChange={event => workspace.setModelAgent(event.target.value as 'navigator' | 'planner')}>
          {workspace.models.length === 0 ? (
            <option value="navigator">{copy.model}</option>
          ) : (
            workspace.models.map(model => (
              <option key={model.agent} value={model.agent}>
                {model.label}
              </option>
            ))
          )}
        </select>
        <FiChevronDown size={12} />
      </label>
      {workspace.mode === 'act' ? (
        <label className="assistant-permission-select">
          <span className="sr-only">{copy.permissions}</span>
          <select
            aria-label={copy.permissions}
            value={workspace.permissionMode}
            disabled={showStopButton}
            onChange={event => workspace.setPermissionMode(event.target.value as 'ask' | 'auto')}>
            <option value="ask">{copy.ask}</option>
            <option value="auto">{copy.auto}</option>
          </select>
          <FiChevronDown size={12} />
        </label>
      ) : (
        <span className="assistant-readonly-dot">{copy.readOnly}</span>
      )}
    </div>
  );
}
