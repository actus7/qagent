import type { MutableRefObject } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
import type { AssistantAttachment } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';
import type { AppendMessage } from '../lib/sidepanel-events';
import type { AssistantWorkspace } from './useAssistantWorkspace';
import { t } from '@extension/i18n';
import type { SidePanelConnection } from './useSidePanelConnection';
import { isChatCommand } from './useChatCommands';
import type { TaskRunState } from './useTaskRunState';
import { useSidePanelActions } from './useSidePanelSelectors';

const SESSION_TITLE_MAX_LENGTH = 50;

interface UseTaskSubmissionArgs {
  workspace: AssistantWorkspace;
  copy: ReturnType<typeof assistantCopy>;
  connection: SidePanelConnection;
  sessionIdRef: MutableRefObject<string | null>;
  appendMessage: AppendMessage;
  handleCommand: (command: string) => Promise<boolean>;
  runState: TaskRunState;
  inputEnabled: boolean;
  showStopButton: boolean;
  hasConfiguredModels: boolean | null;
  isFollowUpMode: boolean;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Sends composer input as a new task, a follow-up task, or a slash command, and cancels running tasks. */
export const useTaskSubmission = ({
  workspace,
  copy,
  connection,
  sessionIdRef,
  appendMessage,
  handleCommand,
  runState,
  inputEnabled,
  showStopButton,
  hasConfiguredModels,
  isFollowUpMode,
}: UseTaskSubmissionArgs) => {
  const { setShowSetupRequiredModal, setInputEnabled, setShowStopButton, setCurrentSessionId, setIsHistoricalSession } =
    useSidePanelActions();
  const { setLastEvent, setIsPaused, setIsStopping, setPendingApproval } = runState;
  const { ensureConnection, sendMessage, stopConnection } = connection;

  const createTaskSession = async (titleText: string) => {
    const isLong = titleText.length > SESSION_TITLE_MAX_LENGTH;
    const title = titleText.substring(0, SESSION_TITLE_MAX_LENGTH) + (isLong ? '...' : '');
    const newSession = await chatHistoryStore.createSession(title);
    setCurrentSessionId(newSession.id);
    sessionIdRef.current = newSession.id;
  };

  const dispatchTask = async (taskId: string, text: string, tabId: number, attachments: AssistantAttachment[]) => {
    const options = {
      mode: workspace.mode,
      permissionMode: workspace.permissionMode,
      tabIds: workspace.selectedTabs.map(tab => tab.id),
      modelAgent: workspace.modelAgent,
    };
    const attachmentsPart = attachments.length > 0 ? { attachments } : {};
    if (isFollowUpMode) {
      await sendMessage({ type: 'follow_up_task', task: text, taskId, tabId, options, ...attachmentsPart });
    } else {
      await sendMessage({ type: 'new_task', task: text, taskId, tabId, options, ...attachmentsPart });
    }
  };

  const handleSendMessage = async (
    text: string,
    displayText?: string,
    attachments: AssistantAttachment[] = [],
  ): Promise<boolean> => {
    const trimmedText = text.trim();

    if ((!trimmedText && attachments.length === 0) || !inputEnabled || showStopButton) return false;
    if (!hasConfiguredModels) {
      setShowSetupRequiredModal(true);
      return false;
    }

    if (isChatCommand(trimmedText)) {
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return true;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error(t('errors_noActiveTab'));
      }
      if (workspace.mode === 'act' && workspace.selectedTabs.length === 0) throw new Error(copy.noActive);

      setInputEnabled(false);
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      if (!sessionIdRef.current) {
        await createTaskSession(displayText || text);
      }

      await appendMessage(
        {
          actor: Actors.USER,
          content: displayText || text, // Use display text for chat UI, full text for background service
          timestamp: Date.now(),
        },
        sessionIdRef.current,
      );
      setIsHistoricalSession(false);
      setLastEvent(null);
      setIsPaused(false);
      setIsStopping(false);

      const taskId = sessionIdRef.current;
      if (!taskId) {
        throw new Error('Task session ID is not available');
      }

      ensureConnection();
      await dispatchTask(taskId, text, tabId, attachments);
    } catch (err) {
      console.error('Task error', errorText(err));
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorText(err),
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
      return false;
    }
    return true;
  };

  const handleStopTask = async () => {
    try {
      setIsStopping(true);
      await sendMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      console.error('cancel_task error', errorText(err));
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorText(err),
        timestamp: Date.now(),
      });
    }
    setPendingApproval(null);
  };

  return { handleSendMessage, handleStopTask };
};
