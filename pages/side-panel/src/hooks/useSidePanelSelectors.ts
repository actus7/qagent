import { useShallow } from 'zustand/react/shallow';
import { useSidePanelStore } from '@src/store/sidePanelStore';

export const useSidePanelState = () => {
  return useSidePanelStore(
    useShallow(state => ({
      messages: state.messages,
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
      isReplaying: state.isReplaying,
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
      setIsReplaying: state.setIsReplaying,
      setReplayEnabled: state.setReplayEnabled,
      setChatDebugMode: state.setChatDebugMode,
      setShowSetupRequiredModal: state.setShowSetupRequiredModal,
      resetChatView: state.resetChatView,
    })),
  );
};
