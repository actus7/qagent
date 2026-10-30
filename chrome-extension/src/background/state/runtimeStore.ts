import { createStore } from 'zustand/vanilla';
import type { Executor } from '../agent/executor';
import type { OverlayMode } from '../overlay/overlayMessaging';
import { DEFAULT_OVERLAY_DRIVER, type OverlayDriver } from '../overlay/overlayDriver';

interface RuntimeState {
  currentExecutor: Executor | null;
  currentPort: chrome.runtime.Port | null;
  overlayStatusText: string | null;
  overlayVisible: boolean;
  overlayMode: OverlayMode;
  // The tab the overlay sits on, and who drives it. Kept so reloads and the side panel restore the same look.
  overlayTabId: number | null;
  overlayDriver: OverlayDriver;
}

interface RuntimeActions {
  setExecutor: (executor: Executor | null) => void;
  setPort: (port: chrome.runtime.Port | null) => void;
  setOverlayStatusText: (status: string | null) => void;
  setOverlayVisible: (visible: boolean) => void;
  setOverlayMode: (mode: OverlayMode) => void;
  setOverlayTabId: (tabId: number | null) => void;
  setOverlayDriver: (driver: OverlayDriver) => void;
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
  overlayTabId: null,
  overlayDriver: DEFAULT_OVERLAY_DRIVER,
};

export const runtimeStore = createStore<RuntimeStore>()(set => ({
  ...initialState,
  setExecutor: currentExecutor => set({ currentExecutor }),
  setPort: currentPort => set({ currentPort }),
  setOverlayStatusText: overlayStatusText => set({ overlayStatusText }),
  setOverlayVisible: overlayVisible => set({ overlayVisible }),
  setOverlayMode: overlayMode => set({ overlayMode }),
  setOverlayTabId: overlayTabId => set({ overlayTabId }),
  setOverlayDriver: overlayDriver => set({ overlayDriver }),
  resetOverlay: () =>
    set({
      overlayVisible: false,
      overlayStatusText: null,
      overlayMode: 'running',
      overlayTabId: null,
      overlayDriver: DEFAULT_OVERLAY_DRIVER,
    }),
  reset: () => set({ ...initialState }),
}));
