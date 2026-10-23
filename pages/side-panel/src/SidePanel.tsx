import { useEffect, useCallback, useRef, useState } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { useTheme, type AssistantMode } from '@extension/shared';
import { useLanguage } from '@extension/shared';
import ChatHistoryList from './components/ChatHistoryList';
import ActionApproval from './components/ActionApproval';
import AssistantHeader from './components/AssistantHeader';
import BrowserPreview from './components/BrowserPreview';
import ComposeArea from './components/ComposeArea';
import ConversationArea from './components/ConversationArea';
import ModeBar from './components/ModeBar';
import SettingsModal from './components/SettingsModal';
import SetupRequiredModal from './components/SetupRequiredModal';
import TaskStatusBar from './components/TaskStatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import { useAssistantWorkspace } from './hooks/useAssistantWorkspace';
import { useChatCommands } from './hooks/useChatCommands';
import { useChatMessages } from './hooks/useChatMessages';
import { useConfigurationSync } from './hooks/useConfigurationSync';
import { useFavoritePromptHandlers } from './hooks/useFavoritePromptHandlers';
import { useHistoryHandlers } from './hooks/useHistoryHandlers';
import { useSidePanelConnection } from './hooks/useSidePanelConnection';
import { useSidePanelActions, useSidePanelState } from './hooks/useSidePanelSelectors';
import { useTaskEventHandler } from './hooks/useTaskEventHandler';
import { useTaskRunState } from './hooks/useTaskRunState';
import { useTaskSubmission } from './hooks/useTaskSubmission';
import { useVoiceInput } from './hooks/useVoiceInput';
import { assistantCopy } from './lib/assistant-copy';
import { toAgentEvent } from './lib/sidepanel-events';
import { ExecutionState, type AgentEvent } from './types/event';
import type {
  BrowserFramePayload,
  BrowserInputPayload,
  BrowserStatusPayload,
  SidePanelResponseMessage,
} from './types/port';

const openOptionsPage = () => chrome.runtime.openOptionsPage();

const SidePanel = () => {
  const isAgentBrowserEngine = import.meta.env.VITE_BROWSER_ENGINE === 'agent-browser';
  const { currentLocale } = useLanguage();
  const copy = assistantCopy(currentLocale);
  const progressMessage = t('sidepanel_progress_message');
  const {
    messages,
    inputEnabled,
    showStopButton,
    showSettings,
    currentSessionId,
    showHistory,
    chatSessions,
    isFollowUpMode,
    isHistoricalSession,
    favoritePrompts,
    hasConfiguredModels,
    isRecording,
    isProcessingSpeech,
    replayEnabled,
    chatDebugMode,
    showSetupRequiredModal,
  } = useSidePanelState();
  const workspace = useAssistantWorkspace(showStopButton);
  const {
    setMessages,
    setInputEnabled,
    setShowStopButton,
    setShowSettings,
    setIsProcessingSpeech,
    setShowSetupRequiredModal,
    setChatSessions,
    setShowHistory,
    setCurrentSessionId,
    setIsFollowUpMode,
    setIsHistoricalSession,
    setFavoritePrompts,
    resetChatView,
  } = useSidePanelActions();

  const sessionIdRef = useRef<string | null>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const handleTaskStateRef = useRef<(event: AgentEvent) => void>(() => {});
  const chatDebugModeRef = useRef<boolean>(false);
  const [browserFrame, setBrowserFrame] = useState<BrowserFramePayload | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatusPayload | null>(null);
  const runState = useTaskRunState();
  const { pendingApproval, setPendingApproval, lastEvent, setLastEvent, isPaused, setIsPaused, isStopping } = runState;
  const isTaskRunningRef = useRef(false);
  // Stream id of the plan-mode answer produced by the current run, used for "Execute this plan"
  const [planStreamId, setPlanStreamId] = useState<string | null>(null);
  const modeRef = useRef(workspace.mode);

  const { theme, cycleTheme } = useTheme();

  const setInputText = useCallback((text: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(text);
    }
  }, []);

  const { handleLoadHistory, handleBackToChat, handleSessionSelect, handleSessionDelete, handleSessionBookmark } =
    useHistoryHandlers({
      currentLocale,
      currentSessionId,
      setChatSessions,
      setShowHistory,
      setCurrentSessionId,
      setMessages,
      setIsFollowUpMode,
      setIsHistoricalSession,
      setFavoritePrompts,
    });

  const { handleBookmarkSelect, handleBookmarkUpdateTitle, handleBookmarkDelete, handleBookmarkReorder } =
    useFavoritePromptHandlers({
      currentLocale,
      setFavoritePrompts,
      setInputText,
    });

  const { handleChatDebugModeChange } = useConfigurationSync(hasConfiguredModels);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const { appendMessage, onAssistantMessage } = useChatMessages({
    sessionIdRef,
    progressMessage,
    setPendingApproval,
  });

  useEffect(() => {
    modeRef.current = workspace.mode;
  }, [workspace.mode]);

  useEffect(() => {
    isTaskRunningRef.current = showStopButton;
  }, [showStopButton]);

  // Clear the plan answer when the open session changes (new chat, history load, first task of a chat)
  // or the run fails/cancels — adjusted during render rather than in effects.
  const [planScope, setPlanScope] = useState({ sessionId: currentSessionId, event: lastEvent });
  if (planScope.sessionId !== currentSessionId || planScope.event !== lastEvent) {
    const failed = lastEvent?.state === ExecutionState.TASK_FAIL || lastEvent?.state === ExecutionState.TASK_CANCEL;
    if (planScope.sessionId !== currentSessionId || (planScope.event !== lastEvent && failed)) setPlanStreamId(null);
    setPlanScope({ sessionId: currentSessionId, event: lastEvent });
  }

  // A past session can be replayed only when replay is enabled and it has recorded agent steps
  const [replayableSessionId, setReplayableSessionId] = useState<string | null>(null);
  const replaySessionId =
    replayEnabled && isHistoricalSession && currentSessionId && replayableSessionId === currentSessionId
      ? currentSessionId
      : null;
  useEffect(() => {
    if (!replayEnabled || !isHistoricalSession || !currentSessionId) return;
    let active = true;
    chatHistoryStore
      .loadAgentStepHistory(currentSessionId)
      .then(history => {
        if (active) setReplayableSessionId(history ? currentSessionId : null);
      })
      .catch(() => {
        if (active) setReplayableSessionId(null);
      });
    return () => {
      active = false;
    };
  }, [currentSessionId, isHistoricalSession, replayEnabled]);


  // Remembers which streamed answer came from a plan-mode run; stable identity so the port listener never goes stale
  const handleAssistantMessage = useCallback(
    (message: SidePanelResponseMessage) => {
      if (message.type === 'assistant_delta' && modeRef.current === 'plan') {
        setPlanStreamId(message.streamId);
      }
      onAssistantMessage(message);
    },
    [onAssistantMessage],
  );

  const connection = useSidePanelConnection({
    appendMessage,
    handleTaskStateRef,
    toAgentEvent,
    chatDebugModeRef,
    isTaskRunningRef,
    setInputEnabled,
    setShowStopButton,
    setIsProcessingSpeech,
    setInputText,
    setBrowserFrame,
    setBrowserStatus,
    onAssistantMessage: handleAssistantMessage,
    resetRunState: runState.resetRunState,
  });
  const { ensureConnection, stopConnection, sendMessage } = connection;

  const handleBrowserInput = useCallback(
    (input: BrowserInputPayload, sessionId?: string) => {
      try {
        ensureConnection();
        sendMessage({
          type: 'browser_input',
          input,
          ...(sessionId ? { sessionId } : {}),
        });
      } catch (error) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    },
    [appendMessage, ensureConnection, sendMessage],
  );

  const handleTaskState = useTaskEventHandler({
    appendMessage,
    sessionIdRef,
    chatDebugMode,
    progressMessage,
    runState,
  });

  useEffect(() => {
    handleTaskStateRef.current = handleTaskState;
  }, [handleTaskState]);

  useEffect(() => {
    chatDebugModeRef.current = chatDebugMode;
  }, [chatDebugMode]);

  const { handleCommand } = useChatCommands({
    appendMessage,
    sessionIdRef,
    connection,
    replayEnabled,
    isHistoricalSession,
  });

  const { handleSendMessage, handleStopTask } = useTaskSubmission({
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
  });

  const { handleMicClick } = useVoiceInput({ appendMessage, connection, isRecording });

  const handleNewChat = () => {
    if (showStopButton) return;
    if (hasConfiguredModels === false) {
      setShowSetupRequiredModal(true);
      return;
    }

    // Clear messages and start a new chat
    resetChatView();
    sessionIdRef.current = null;

    // Disconnect any existing connection
    stopConnection();
    setBrowserFrame(null);
    setBrowserStatus(null);
    setLastEvent(null);
    setPlanStreamId(null);
  };

  const handleTogglePause = () => {
    sendMessage({ type: isPaused ? 'resume_task' : 'pause_task' });
    setIsPaused(!isPaused);
  };

  const handleSuggestion = (mode: AssistantMode, prompt: string) => {
    workspace.setMode(mode);
    setInputText(prompt);
  };

  const handleExecutePlan = (planAnswer: string) => {
    workspace.setMode('act');
    setInputText(copy.executePlan + ':\n\n' + planAnswer);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  const planAnswerMessage = planStreamId
    ? messages.filter(message => message.streamId === planStreamId).at(-1)
    : undefined;
  const planAnswer =
    workspace.mode === 'plan' && planAnswerMessage && !showStopButton ? planAnswerMessage.content : null;

  return (
    <div data-locale={currentLocale} className="assistant-shell">
      <AssistantHeader
        showHistory={showHistory}
        showStopButton={showStopButton}
        theme={theme}
        onCycleTheme={cycleTheme}
        onBackToChat={() => handleBackToChat(false)}
        onNewChat={handleNewChat}
        onLoadHistory={handleLoadHistory}
        onOpenSettings={() => setShowSettings(true)}
      />
      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatHistoryList
            sessions={chatSessions}
            onSessionSelect={handleSessionSelect}
            onSessionDelete={handleSessionDelete}
            onSessionBookmark={handleSessionBookmark}
          />
        </div>
      ) : (
        <>
          <ModeBar copy={copy} mode={workspace.mode} disabled={showStopButton} onModeChange={workspace.setMode} />
          {isAgentBrowserEngine && hasConfiguredModels ? (
            <BrowserPreview
              frame={browserFrame}
              status={browserStatus}
              sessionId={currentSessionId}
              disabled={!inputEnabled}
              onInput={handleBrowserInput}
            />
          ) : null}
          <ConversationArea
            copy={copy}
            isCheckingConfig={hasConfiguredModels === null}
            messages={messages}
            planAnswer={planAnswer}
            onExecutePlan={handleExecutePlan}
            welcome={
              <WelcomeScreen
                copy={copy}
                hasConfiguredModels={hasConfiguredModels === true}
                favoritePrompts={favoritePrompts}
                bookmarkHandlers={{
                  onBookmarkSelect: handleBookmarkSelect,
                  onBookmarkUpdateTitle: handleBookmarkUpdateTitle,
                  onBookmarkDelete: handleBookmarkDelete,
                  onBookmarkReorder: handleBookmarkReorder,
                }}
                onSuggestionSelect={handleSuggestion}
                onOpenOptions={openOptionsPage}
              />
            }
          />
          {pendingApproval ? (
            <ActionApproval
              request={pendingApproval}
              copy={copy}
              onResolve={approved => {
                try {
                  sendMessage({
                    type: 'approval_result',
                    taskId: pendingApproval.taskId,
                    requestId: pendingApproval.id,
                    approved,
                  });
                } catch (error) {
                  appendMessage({
                    actor: Actors.SYSTEM,
                    content: error instanceof Error ? error.message : String(error),
                    timestamp: Date.now(),
                  });
                } finally {
                  setPendingApproval(null);
                }
              }}
            />
          ) : null}
          {showStopButton ? (
            <TaskStatusBar
              copy={copy}
              mode={workspace.mode}
              isPaused={isPaused}
              isStopping={isStopping}
              hasPendingApproval={pendingApproval !== null}
              lastEvent={lastEvent}
              onTogglePause={handleTogglePause}
            />
          ) : null}
          <ComposeArea
            copy={copy}
            workspace={workspace}
            inputEnabled={inputEnabled}
            hasConfiguredModels={hasConfiguredModels}
            showStopButton={showStopButton}
            isRecording={isRecording}
            isProcessingSpeech={isProcessingSpeech}
            onSendMessage={handleSendMessage}
            onStopTask={handleStopTask}
            onMicToggle={handleMicClick}
            onRegisterInputSetter={setter => {
              setInputTextRef.current = setter;
            }}
            replaySessionId={replaySessionId}
          />
        </>
      )}
      {showSettings ? (
        <SettingsModal
          chatDebugMode={chatDebugMode}
          onClose={() => setShowSettings(false)}
          onChatDebugModeChange={handleChatDebugModeChange}
        />
      ) : null}
      {showSetupRequiredModal ? (
        <SetupRequiredModal onClose={() => setShowSetupRequiredModal(false)} onOpenSettings={openOptionsPage} />
      ) : null}
    </div>
  );
};

export default SidePanel;
