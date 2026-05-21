import { create } from 'zustand';
import type { Message } from '@extension/storage';
import type { FavoritePrompt } from '@extension/storage/lib/prompt/favorites';

export interface ChatSessionMetadata {
  id: string;
  title: string;
  createdAt: number;
}

interface SidePanelState {
  messages: Message[];
  inputEnabled: boolean;
  showStopButton: boolean;
  showSettings: boolean;
  currentSessionId: string | null;
  showHistory: boolean;
  chatSessions: ChatSessionMetadata[];
  isFollowUpMode: boolean;
  isHistoricalSession: boolean;
  favoritePrompts: FavoritePrompt[];
  hasConfiguredModels: boolean | null;
  isRecording: boolean;
  isProcessingSpeech: boolean;
  isReplaying: boolean;
  replayEnabled: boolean;
  chatDebugMode: boolean;
  showSetupRequiredModal: boolean;
}

interface SidePanelActions {
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setInputEnabled: (value: boolean) => void;
  setShowStopButton: (value: boolean) => void;
  setShowSettings: (value: boolean) => void;
  setCurrentSessionId: (value: string | null) => void;
  setShowHistory: (value: boolean) => void;
  setChatSessions: (value: ChatSessionMetadata[]) => void;
  setIsFollowUpMode: (value: boolean) => void;
  setIsHistoricalSession: (value: boolean) => void;
  setFavoritePrompts: (value: FavoritePrompt[]) => void;
  setHasConfiguredModels: (value: boolean | null) => void;
  setIsRecording: (value: boolean) => void;
  setIsProcessingSpeech: (value: boolean) => void;
  setIsReplaying: (value: boolean) => void;
  setReplayEnabled: (value: boolean) => void;
  setChatDebugMode: (value: boolean) => void;
  setShowSetupRequiredModal: (value: boolean) => void;
  resetChatView: () => void;
}

type SidePanelStore = SidePanelState & SidePanelActions;

const initialState: SidePanelState = {
  messages: [],
  inputEnabled: true,
  showStopButton: false,
  showSettings: false,
  currentSessionId: null,
  showHistory: false,
  chatSessions: [],
  isFollowUpMode: false,
  isHistoricalSession: false,
  favoritePrompts: [],
  hasConfiguredModels: null,
  isRecording: false,
  isProcessingSpeech: false,
  isReplaying: false,
  replayEnabled: false,
  chatDebugMode: false,
  showSetupRequiredModal: false,
};

export const useSidePanelStore = create<SidePanelStore>()((set, get) => ({
  ...initialState,
  setMessages: messages =>
    set({
      messages: typeof messages === 'function' ? messages(get().messages) : messages,
    }),
  setInputEnabled: inputEnabled => set({ inputEnabled }),
  setShowStopButton: showStopButton => set({ showStopButton }),
  setShowSettings: showSettings => set({ showSettings }),
  setCurrentSessionId: currentSessionId => set({ currentSessionId }),
  setShowHistory: showHistory => set({ showHistory }),
  setChatSessions: chatSessions => set({ chatSessions }),
  setIsFollowUpMode: isFollowUpMode => set({ isFollowUpMode }),
  setIsHistoricalSession: isHistoricalSession => set({ isHistoricalSession }),
  setFavoritePrompts: favoritePrompts => set({ favoritePrompts }),
  setHasConfiguredModels: hasConfiguredModels => set({ hasConfiguredModels }),
  setIsRecording: isRecording => set({ isRecording }),
  setIsProcessingSpeech: isProcessingSpeech => set({ isProcessingSpeech }),
  setIsReplaying: isReplaying => set({ isReplaying }),
  setReplayEnabled: replayEnabled => set({ replayEnabled }),
  setChatDebugMode: chatDebugMode => set({ chatDebugMode }),
  setShowSetupRequiredModal: showSetupRequiredModal => set({ showSetupRequiredModal }),
  resetChatView: () =>
    set({
      messages: [],
      currentSessionId: null,
      inputEnabled: true,
      showStopButton: false,
      isFollowUpMode: false,
      isHistoricalSession: false,
    }),
}));
