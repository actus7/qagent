import { useShallow } from 'zustand/react/shallow';
import { useSidePanelStore } from '@src/store/sidePanelStore';

/** Messages change on every streamed delta, so only the conversation view subscribes to them. */
export const useSidePanelMessages = () => useSidePanelStore(state => state.messages);

export const useSidePanelState = () => {
  return useSidePanelStore(
    useShallow(state => ({
      inputEnabled: state.inputEnabled,
      showStopButton: state.showStopButton,
      showSettings: state.showSettings,
      currentSessionId: state.currentSessionId,
      showHistory: state.showHistory,
      chatSessions: state.chatSessions,
      isFollowUpMode: state.isFollowUpMode,
      isHistoricalSession: state.isHistoricalSession,
      favoritePrompts: state.favoritePrompts,
      hasConfiguredModels: state.hasConfiguredModels,
      isRecording: state.isRecording,
      isProcessingSpeech: state.isProcessingSpeech,
      replayEnabled: state.replayEnabled,
      chatDebugMode: state.chatDebugMode,
      showSetupRequiredModal: state.showSetupRequiredModal,
    })),
  );
};

export const useSidePanelActions = () => {
  return useSidePanelStore(
    useShallow(state => ({
      setMessages: state.setMessages,
      setInputEnabled: state.setInputEnabled,
      setShowStopButton: state.setShowStopButton,
      setShowSettings: state.setShowSettings,
      setCurrentSessionId: state.setCurrentSessionId,
      setShowHistory: state.setShowHistory,
      setChatSessions: state.setChatSessions,
      setIsFollowUpMode: state.setIsFollowUpMode,
      setIsHistoricalSession: state.setIsHistoricalSession,
      setFavoritePrompts: state.setFavoritePrompts,
      setHasConfiguredModels: state.setHasConfiguredModels,
      setIsRecording: state.setIsRecording,
      setIsProcessingSpeech: state.setIsProcessingSpeech,
      setReplayEnabled: state.setReplayEnabled,
      setChatDebugMode: state.setChatDebugMode,
      setShowSetupRequiredModal: state.setShowSetupRequiredModal,
      resetChatView: state.resetChatView,
    })),
  );
};
