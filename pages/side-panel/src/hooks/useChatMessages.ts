import { useCallback, type MutableRefObject } from 'react';
import { Actors, chatHistoryStore, type Message } from '@extension/storage';
import { t } from '@extension/i18n';
import type { SidePanelResponseMessage } from '../types/port';
import { useSidePanelActions } from './useSidePanelSelectors';

interface UseChatMessagesArgs {
  sessionIdRef: MutableRefObject<string | null>;
  progressMessage: string;
}

/** Appends chat messages (persisting them when a session exists) and applies assistant stream events. */
export const useChatMessages = ({ sessionIdRef, progressMessage }: UseChatMessagesArgs) => {
  const { setMessages } = useSidePanelActions();

  const appendMessage = useCallback(
    (newMessage: Message, sessionId?: string | null) => {
      // Don't save progress messages
      const isProgressMessage = newMessage.content === progressMessage;

      setMessages(prev => {
        const filteredMessages = prev.filter(
          (msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1),
        );
        return [...filteredMessages, newMessage];
      });

      // Use provided sessionId if available, otherwise fall back to sessionIdRef.current
      const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

      // Save message to storage if we have a session and it's not a progress message
      if (effectiveSessionId && !isProgressMessage) {
        return chatHistoryStore
          .addMessage(effectiveSessionId, newMessage)
          .catch(err => console.error('Failed to save message to history:', err));
      }
      return Promise.resolve();
    },
    [progressMessage, sessionIdRef, setMessages],
  );

  const onAssistantMessage = useCallback(
    (message: SidePanelResponseMessage) => {
      if (message.type === 'conversation_compacted') {
        if (message.taskId !== sessionIdRef.current) return;
        if (!message.compacted) {
          setMessages(previous => [
            ...previous,
            { actor: Actors.SYSTEM, content: t('chat_compact_nothing'), timestamp: Date.now() },
          ]);
          return;
        }
        // The summary lives in storage; reloading shows the divider and keeps the full history visible.
        void chatHistoryStore.getSession(message.taskId).then(session => {
          if (session && message.taskId === sessionIdRef.current) setMessages(session.messages);
        });
      } else if (message.type === 'assistant_delta' && message.taskId === sessionIdRef.current) {
        // The background persists the finished answer. Streaming updates are display-only.
        setMessages(previous => {
          const hasProgress = previous.some(item => item.content === progressMessage);
          const next = hasProgress ? previous.filter(item => item.content !== progressMessage) : previous;
          const answerIndex = next.findIndex(item => item.streamId === message.streamId);
          const answer: Message = {
            actor: Actors.ASSISTANT,
            content: message.content,
            streamId: message.streamId,
            kind: 'answer',
            timestamp: answerIndex >= 0 ? next[answerIndex].timestamp : Date.now(),
          };
          // One copy per delta; the other items keep their identity so memoized rows skip re-rendering.
          if (answerIndex < 0) return [...next, answer];
          const updated = next.slice();
          updated[answerIndex] = answer;
          return updated;
        });
      }
    },
    [setMessages, progressMessage, sessionIdRef],
  );

  return { appendMessage, onAssistantMessage };
};
