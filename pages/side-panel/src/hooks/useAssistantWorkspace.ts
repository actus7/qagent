import { useCallback, useEffect, useState } from 'react';
import { agentModelStore, AgentNameEnum } from '@extension/storage';
import type { AssistantMode, PermissionMode } from '@extension/shared';

export interface WorkspaceTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
  favIconUrl?: string;
}
export interface WorkspaceModel {
  agent: 'navigator' | 'planner';
  label: string;
}

function preference<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const value = localStorage.getItem(key) as T | null;
  return value && values.includes(value) ? value : fallback;
}

export function useAssistantWorkspace(frozen = false) {
  const [mode, setMode] = useState<AssistantMode>(() => preference('qagent-mode', ['chat', 'plan', 'act'], 'chat'));
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    preference('qagent-permission', ['ask', 'auto'], 'ask'),
  );
  const [modelAgent, setModelAgent] = useState<'navigator' | 'planner'>(() =>
    preference('qagent-model-agent', ['navigator', 'planner'], 'navigator'),
  );
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [followActive, setFollowActive] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    localStorage.setItem('qagent-mode', mode);
  }, [mode]);
  useEffect(() => {
    localStorage.setItem('qagent-permission', permissionMode);
  }, [permissionMode]);
  useEffect(() => {
    localStorage.setItem('qagent-model-agent', modelAgent);
  }, [modelAgent]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const configs = await agentModelStore.getAllAgentModels();
      if (disposed) return;
      const available = [AgentNameEnum.Navigator, AgentNameEnum.Planner].flatMap(agent => {
        const config = configs[agent];
        return config ? [{ agent, label: config.modelName }] : [];
      });
      setModels(available);
      setModelAgent(current =>
        available.some(model => model.agent === current) ? current : (available[0]?.agent ?? 'navigator'),
      );
    };
    void refresh().catch(console.error);
    const unsubscribe = agentModelStore.subscribe(() => {
      void refresh().catch(console.error);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const all = await chrome.tabs.query({ currentWindow: true });
        if (disposed) return;
        const available = all.flatMap(tab =>
          tab.id !== undefined &&
          tab.url &&
          /^https?:\/\//i.test(tab.url) &&
          new URL(tab.url).hostname !== 'chromewebstore.google.com'
            ? [
                {
                  id: tab.id,
                  title: tab.title || new URL(tab.url).hostname,
                  url: tab.url,
                  active: !!tab.active,
                  favIconUrl: tab.favIconUrl?.startsWith('https://') ? tab.favIconUrl : undefined,
                },
              ]
            : [],
        );
        setTabs(available);
        setSelectedIds(current =>
          followActive && !frozen
            ? available.filter(tab => tab.active).map(tab => tab.id)
            : current.filter(id => available.some(tab => tab.id === id)),
        );
        setError('');
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const refreshListener = () => {
      void refresh();
    };
    refreshListener();
    chrome.tabs.onActivated.addListener(refreshListener);
    chrome.tabs.onUpdated.addListener(refreshListener);
    chrome.tabs.onRemoved.addListener(refreshListener);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(refreshListener);
      chrome.tabs.onUpdated.removeListener(refreshListener);
      chrome.tabs.onRemoved.removeListener(refreshListener);
    };
  }, [followActive, frozen]);

  const toggleTab = useCallback((id: number) => {
    setFollowActive(false);
    setSelectedIds(current =>
      current.includes(id) ? current.filter(tabId => tabId !== id) : current.length < 12 ? [...current, id] : current,
    );
  }, []);

  // Context-menu prefills scope the task to the tab the user clicked in
  const selectOnlyTab = useCallback((id: number) => {
    setFollowActive(false);
    setSelectedIds([id]);
  }, []);

  /** Adds a tab to the scope without toggling it off when it is already selected (used by "@" mentions). */
  const addTab = useCallback((id: number) => {
    setFollowActive(false);
    setSelectedIds(current => (current.includes(id) || current.length >= 12 ? current : [...current, id]));
  }, []);

  return {
    mode,
    setMode,
    selectOnlyTab,
    permissionMode,
    setPermissionMode,
    modelAgent,
    setModelAgent,
    models,
    tabs,
    selectedTabs: tabs.filter(tab => selectedIds.includes(tab.id)),
    toggleTab,
    addTab,
    followActive,
    followActiveTab: () => setFollowActive(true),
    error,
  };
}

export type AssistantWorkspace = ReturnType<typeof useAssistantWorkspace>;
