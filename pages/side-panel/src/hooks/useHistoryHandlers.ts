import { useCallback } from 'react';
import { chatHistoryStore, type Message } from '@extension/storage';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import type { FavoritePrompt } from '@extension/storage/lib/prompt/favorites';

interface UseHistoryHandlersArgs {
  currentLocale: string;
  currentSessionId: string | null;
  setChatSessions: (value: { id: string; title: string; createdAt: number }[]) => void;
  setShowHistory: (value: boolean) => void;
  setCurrentSessionId: (value: string | null) => void;
  setMessages: (messages: Message[]) => void;
  setIsFollowUpMode: (value: boolean) => void;
  setIsHistoricalSession: (value: boolean) => void;
  setFavoritePrompts: (value: FavoritePrompt[]) => void;
}

export const useHistoryHandlers = ({
  currentLocale,
  currentSessionId,
  setChatSessions,
  setShowHistory,
  setCurrentSessionId,
  setMessages,
  setIsFollowUpMode,
  setIsHistoricalSession,
  setFavoritePrompts,
}: UseHistoryHandlersArgs) => {
  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, [setChatSessions]);

  const handleLoadHistory = useCallback(async () => {
    await loadChatSessions();
    setShowHistory(true);
  }, [loadChatSessions, setShowHistory]);

  const handleBackToChat = useCallback(
    (reset = false) => {
      setShowHistory(false);
      if (reset) {
        setCurrentSessionId(null);
        setMessages([]);
        setIsFollowUpMode(false);
        setIsHistoricalSession(false);
      }
    },
    [setCurrentSessionId, setIsFollowUpMode, setIsHistoricalSession, setMessages, setShowHistory],
  );

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      try {
        const fullSession = await chatHistoryStore.getSession(sessionId);
        if (fullSession && fullSession.messages.length > 0) {
          setCurrentSessionId(fullSession.id);
          setMessages(fullSession.messages);
          setIsFollowUpMode(false);
          setIsHistoricalSession(true);
        }
        setShowHistory(false);
      } catch (error) {
        console.error('Failed to load session:', error);
      }
    },
    [setCurrentSessionId, setIsFollowUpMode, setIsHistoricalSession, setMessages, setShowHistory],
  );

  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      try {
        await chatHistoryStore.deleteSession(sessionId);
        await loadChatSessions();
        if (sessionId === currentSessionId) {
          setMessages([]);
          setCurrentSessionId(null);
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    },
    [currentSessionId, loadChatSessions, setCurrentSessionId, setMessages],
  );

  const handleSessionBookmark = useCallback(
    async (sessionId: string) => {
      try {
        const fullSession = await chatHistoryStore.getSession(sessionId);

        if (fullSession && fullSession.messages.length > 0) {
          const sessionTitle = fullSession.title;
          const title = sessionTitle.split(' ').slice(0, 8).join(' ');
          const taskContent = fullSession.messages[0]?.content || '';

          await favoritesStorage.addPrompt(title, taskContent);

          const prompts = await favoritesStorage.getAllPrompts(currentLocale);
          setFavoritePrompts(prompts);
          handleBackToChat(true);
        }
      } catch (error) {
        console.error('Failed to pin session to favorites:', error);
      }
    },
    [currentLocale, handleBackToChat, setFavoritePrompts],
  );

  return {
    loadChatSessions,
    handleLoadHistory,
    handleBackToChat,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
  };
};
