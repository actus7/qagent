import { createStore } from 'zustand/vanilla';
import type { Executor } from '../agent/executor';
import type { OverlayMode } from '../overlay/overlayMessaging';

interface RuntimeState {
  currentExecutor: Executor | null;
  currentPort: chrome.runtime.Port | null;
  overlayStatusText: string | null;
  overlayVisible: boolean;
  overlayMode: OverlayMode;
}

interface RuntimeActions {
  setExecutor: (executor: Executor | null) => void;
  setPort: (port: chrome.runtime.Port | null) => void;
  setOverlayStatusText: (status: string | null) => void;
  setOverlayVisible: (visible: boolean) => void;
  setOverlayMode: (mode: OverlayMode) => void;
  resetOverlay: () => void;
  reset: () => void;
}

type RuntimeStore = RuntimeState & RuntimeActions;

const initialState: RuntimeState = {
  currentExecutor: null,
  currentPort: null,
  overlayStatusText: null,
  overlayVisible: false,
  overlayMode: 'running',
};

export const runtimeStore = createStore<RuntimeStore>()(set => ({
  ...initialState,
  setExecutor: currentExecutor => set({ currentExecutor }),
  setPort: currentPort => set({ currentPort }),
  setOverlayStatusText: overlayStatusText => set({ overlayStatusText }),
  setOverlayVisible: overlayVisible => set({ overlayVisible }),
  setOverlayMode: overlayMode => set({ overlayMode }),
  resetOverlay: () => set({ overlayVisible: false, overlayStatusText: null, overlayMode: 'running' }),
  reset: () => set({ ...initialState }),
}));
