import { useCallback, type MutableRefObject } from 'react';
import { Actors, chatHistoryStore, type Message } from '@extension/storage';
import type { SidePanelResponseMessage } from '../types/port';
import type { ActionApproval as Approval } from '@extension/shared';
import { useSidePanelActions } from './useSidePanelSelectors';

interface UseChatMessagesArgs {
  sessionIdRef: MutableRefObject<string | null>;
  progressMessage: string;
  setPendingApproval: (value: Approval | null | ((current: Approval | null) => Approval | null)) => void;
}

/** Appends chat messages (persisting them when a session exists) and applies assistant stream/approval events. */
export const useChatMessages = ({ sessionIdRef, progressMessage, setPendingApproval }: UseChatMessagesArgs) => {
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
    [progressMessage, setMessages],
  );

  const onAssistantMessage = useCallback(
    (message: SidePanelResponseMessage) => {
      if (message.type === 'approval_required') {
        if (message.request.taskId === sessionIdRef.current) setPendingApproval(message.request);
      } else if (message.type === 'approval_resolved') {
        setPendingApproval(current => (current?.id === message.requestId ? null : current));
      } else if (message.type === 'assistant_delta' && message.taskId === sessionIdRef.current) {
        // The background persists the finished answer. Streaming updates are display-only.
        setMessages(previous => {
          const existing = previous.findIndex(item => item.streamId === message.streamId);
          const answer: Message = {
            actor: Actors.ASSISTANT,
            content: message.content,
            streamId: message.streamId,
            kind: 'answer',
            timestamp: existing >= 0 ? previous[existing].timestamp : Date.now(),
          };
          const next = previous.filter(item => item.content !== progressMessage);
          const answerIndex = next.findIndex(item => item.streamId === message.streamId);
          if (answerIndex >= 0) return next.map((item, index) => (index === answerIndex ? answer : item));
          return [...next, answer];
        });
      }
    },
    [setMessages, progressMessage, setPendingApproval],
  );

  return { appendMessage, onAssistantMessage };
};
