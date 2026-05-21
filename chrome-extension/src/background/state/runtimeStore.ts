import { createStore } from 'zustand/vanilla';
import type { Executor } from '../agent/executor';

interface RuntimeState {
  currentExecutor: Executor | null;
  currentPort: chrome.runtime.Port | null;
  overlayStatusText: string | null;
  overlayVisible: boolean;
}

interface RuntimeActions {
  setExecutor: (executor: Executor | null) => void;
  setPort: (port: chrome.runtime.Port | null) => void;
  setOverlayStatusText: (status: string | null) => void;
  setOverlayVisible: (visible: boolean) => void;
  resetOverlay: () => void;
  reset: () => void;
}

export type RuntimeStore = RuntimeState & RuntimeActions;

const initialState: RuntimeState = {
  currentExecutor: null,
  currentPort: null,
  overlayStatusText: null,
  overlayVisible: false,
};

export const runtimeStore = createStore<RuntimeStore>()(set => ({
  ...initialState,
  setExecutor: currentExecutor => set({ currentExecutor }),
  setPort: currentPort => set({ currentPort }),
  setOverlayStatusText: overlayStatusText => set({ overlayStatusText }),
  setOverlayVisible: overlayVisible => set({ overlayVisible }),
  resetOverlay: () => set({ overlayVisible: false, overlayStatusText: null }),
  reset: () => set({ ...initialState }),
}));
