import type { MutableRefObject } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { AppendMessage } from '../lib/sidepanel-events';
import type { SidePanelConnection } from './useSidePanelConnection';
import { useSidePanelActions } from './useSidePanelSelectors';

interface UseChatCommandsArgs {
  appendMessage: AppendMessage;
  sessionIdRef: MutableRefObject<string | null>;
  connection: SidePanelConnection;
  replayEnabled: boolean;
  isHistoricalSession: boolean;
}

/** Slash commands typed in the composer (/state, /nohighlight, /replay <id>). */
export const useChatCommands = ({
  appendMessage,
  sessionIdRef,
  connection,
  replayEnabled,
  isHistoricalSession,
}: UseChatCommandsArgs) => {
  const {
    setMessages,
    setInputEnabled,
    setShowStopButton,
    setCurrentSessionId,
    setIsFollowUpMode,
    setIsHistoricalSession,
    setIsReplaying,
  } = useSidePanelActions();
  const { ensureConnection, sendMessage } = connection;

  const handleReplay = async (historySessionId: string): Promise<void> => {
    try {
      // Check if replay is enabled in settings
      if (!replayEnabled) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_disabled'),
          timestamp: Date.now(),
        });
        return;
      }

      // Check if history exists using loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
          timestamp: Date.now(),
        });
        return;
      }

      // Get current tab ID
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Clear messages if we're in a historical session
      if (isHistoricalSession) {
        setMessages([]);
      }

      // Create a new chat session for this replay task
      const newSession = await chatHistoryStore.createSession(
        `${t('chat_replay_prefix')}${historySessionId.substring(0, 20)}...`,
      );

      // Store the new session ID in both state and ref
      const newTaskId = newSession.id;
      setCurrentSessionId(newTaskId);
      sessionIdRef.current = newTaskId;

      // Send replay command to background
      setInputEnabled(false);
      setShowStopButton(true);

      // Reset follow-up mode and historical session flags
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);

      // Add the user message to the new session
      appendMessage(
        {
          actor: Actors.USER,
          content: `/replay ${historySessionId}`,
          timestamp: Date.now(),
        },
        sessionIdRef.current,
      );

      ensureConnection();

      // Send replay command to background with the task from history
      await sendMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // Add the task from history
      });

      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_starting', historyData.task),
        timestamp: Date.now(),
      });
      setIsReplaying(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_failed', errorMessage),
        timestamp: Date.now(),
      });
    }
  };

  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      ensureConnection();

      if (command === '/state') {
        await sendMessage({ type: 'state' });
        return true;
      }

      if (command === '/nohighlight') {
        await sendMessage({ type: 'nohighlight' });
        return true;
      }

      if (command.startsWith('/replay ')) {
        // Parse replay command: /replay <historySessionId>
        // Handle multiple spaces by filtering out empty strings
        const parts = command.split(' ').filter(part => part.trim() !== '');
        if (parts.length !== 2) {
          appendMessage({
            actor: Actors.SYSTEM,
            content: t('chat_replay_invalidArgs'),
            timestamp: Date.now(),
          });
          return true;
        }

        await handleReplay(parts[1]);
        return true;
      }

      // Unsupported command
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_cmd_unknown', command),
        timestamp: Date.now(),
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Command error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      return true;
    }
  };

  return { handleCommand };
};
