import { FiGlobe, FiPlus, FiX, FiCheck, FiCrosshair } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { WorkspaceTab } from '../hooks/useAssistantWorkspace';
import type { assistantCopy } from '../lib/assistant-copy';

interface Props {
  tabs: WorkspaceTab[];
  selectedTabs: WorkspaceTab[];
  onToggle: (id: number) => void;
  onUseActive: () => void;
  followActive: boolean;
  disabled: boolean;
  copy: ReturnType<typeof assistantCopy>;
}

export default function PageContext({
  tabs,
  selectedTabs,
  onToggle,
  onUseActive,
  followActive,
  disabled,
  copy,
}: Props) {
  return (
    <div className="assistant-context" aria-label={copy.tabs}>
      <div className="assistant-context-chips">
        {selectedTabs.length === 0 ? (
          <span className="assistant-context-empty">
            <FiGlobe />
            {copy.noTabs}
          </span>
        ) : (
          selectedTabs.map(tab => (
            <span className="assistant-tab-chip" key={tab.id} title={tab.url}>
              <FiGlobe />
              <span>{tab.title}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(tab.id)}
                aria-label={t('chat_pageContext_removeTab', [tab.title])}>
                <FiX />
              </button>
            </span>
          ))
        )}
      </div>
      <details className="assistant-tabs-menu">
        <summary aria-label={copy.addTabs} title={copy.addTabs}>
          <FiPlus size={15} />
        </summary>
        <div className="assistant-tabs-popover">
          <div className="assistant-popover-title">
            {copy.addTabs}
            <span>{selectedTabs.length}/12</span>
          </div>
          <p>{copy.tabsHint}</p>
          <button type="button" className="assistant-follow-tab" onClick={onUseActive} disabled={disabled}>
            <FiCrosshair />
            {copy.activeTab}
            {followActive ? <FiCheck /> : null}
          </button>
          <div className="assistant-tabs-list">
            {tabs.map(tab => (
              <label key={tab.id} htmlFor={'context-tab-' + tab.id} title={tab.url} aria-label={tab.title}>
                <input
                  id={'context-tab-' + tab.id}
                  type="checkbox"
                  checked={selectedTabs.some(selected => selected.id === tab.id)}
                  disabled={
                    disabled || (selectedTabs.length >= 12 && !selectedTabs.some(selected => selected.id === tab.id))
                  }
                  onChange={() => onToggle(tab.id)}
                />
                <span>
                  <strong>{tab.title}</strong>
                  <small>{new URL(tab.url).hostname}</small>
                </span>
              </label>
            ))}
            {tabs.length === 0 ? <p>{copy.noActive}</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}
