import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { formatContextPrefill, useTheme, type AssistantMode } from '@extension/shared';
import { useLanguage } from '@extension/shared';
import ChatHistoryList from './components/ChatHistoryList';
import AssistantHeader from './components/AssistantHeader';
import BrowserPreview from './components/BrowserPreview';
import ComposeArea from './components/ComposeArea';
import ConversationArea from './components/ConversationArea';
import ScheduleDialog from './components/ScheduleDialog';
import SettingsModal from './components/SettingsModal';
import SetupRequiredModal from './components/SetupRequiredModal';
import TaskStatusBar from './components/TaskStatusBar';
import TakeoverBanner from './components/TakeoverBanner';
import QuestionBanner from './components/QuestionBanner';
import WelcomeScreen from './components/WelcomeScreen';
import WorkflowRecordControl from './components/WorkflowRecordControl';
import { useAssistantWorkspace } from './hooks/useAssistantWorkspace';
import { useChatCommands } from './hooks/useChatCommands';
import { useChatMessages } from './hooks/useChatMessages';
import { exportSessionReport } from './lib/export-session-report';
import { useContextPrefill } from './hooks/useContextPrefill';
import { useConfigurationSync } from './hooks/useConfigurationSync';
import { useFavoritePromptHandlers } from './hooks/useFavoritePromptHandlers';
import { useHistoryHandlers } from './hooks/useHistoryHandlers';
import { useSidePanelConnection } from './hooks/useSidePanelConnection';
import { useStableCallback } from './hooks/useStableCallback';
import { useSidePanelActions, useSidePanelState } from './hooks/useSidePanelSelectors';
import { useTaskEventHandler } from './hooks/useTaskEventHandler';
import { useTaskRunState } from './hooks/useTaskRunState';
import { useTaskSubmission } from './hooks/useTaskSubmission';
import { useVoiceInput } from './hooks/useVoiceInput';
import { assistantCopy } from './lib/assistant-copy';
import { requestTabCapture } from './lib/tab-capture';
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
  const copy = useMemo(() => assistantCopy(currentLocale), [currentLocale]);
  const progressMessage = t('sidepanel_progress_message');
  const {
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
  // Prompt the schedule dialog opens with; null while the dialog is closed.
  const [schedulePrompt, setSchedulePrompt] = useState<string | null>(null);
  const runState = useTaskRunState();
  const { lastEvent, setLastEvent, isPaused, setIsPaused, isStopping, takeover, setTakeover, question, setQuestion } =
    runState;
  const isTaskRunningRef = useRef(false);
  // Stream id of the plan-mode answer produced by the current run, used for "Execute this plan"
  const [planStreamId, setPlanStreamId] = useState<string | null>(null);
  const modeRef = useRef(workspace.mode);

  const { theme, cycleTheme } = useTheme();
  const stableCycleTheme = useStableCallback(cycleTheme);

  const setInputText = useCallback((text: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(text);
    }
  }, []);

  // Stable identity: ChatInput re-registers its setter in an effect that depends on this callback.
  const registerInputSetter = useCallback((setter: (text: string) => void) => {
    setInputTextRef.current = setter;
  }, []);

  // "Perguntar ao QAgent": quote the context in the composer and scope the task to the clicked tab
  useContextPrefill({
    onPrefill: payload => {
      workspace.selectOnlyTab(payload.tabId);
      setInputText(
        formatContextPrefill(payload, {
          page: t('chat_context_page'),
          link: t('chat_context_link'),
          image: t('chat_context_image'),
          selection: t('chat_context_selection'),
        }),
      );
    },
  });

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
  const stableLoadHistory = useStableCallback(handleLoadHistory);
  const stableBackToChat = useStableCallback(() => handleBackToChat(false));

  const { handleBookmarkSelect, handleBookmarkUpdateTitle, handleBookmarkDelete, handleBookmarkReorder } =
    useFavoritePromptHandlers({
      currentLocale,
      setFavoritePrompts,
      setInputText,
    });
  const stableBookmarkSelect = useStableCallback(handleBookmarkSelect);
  const stableBookmarkUpdateTitle = useStableCallback(handleBookmarkUpdateTitle);
  const stableBookmarkDelete = useStableCallback(handleBookmarkDelete);
  const stableBookmarkReorder = useStableCallback(handleBookmarkReorder);
  const bookmarkHandlers = useMemo(
    () => ({
      onBookmarkSelect: stableBookmarkSelect,
      onBookmarkUpdateTitle: stableBookmarkUpdateTitle,
      onBookmarkDelete: stableBookmarkDelete,
      onBookmarkReorder: stableBookmarkReorder,
    }),
    [stableBookmarkSelect, stableBookmarkUpdateTitle, stableBookmarkDelete, stableBookmarkReorder],
  );

  const { handleChatDebugModeChange } = useConfigurationSync(hasConfiguredModels);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const { appendMessage, onAssistantMessage } = useChatMessages({
    sessionIdRef,
    progressMessage,
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
  // Stable identities for memoized children; each one calls the latest handler.
  const sendComposerMessage = useStableCallback(handleSendMessage);
  const stopComposerTask = useStableCallback(handleStopTask);
  const handleContinue = useCallback(() => void sendComposerMessage(t('chat_continueCommand')), [sendComposerMessage]);

  const { handleMicClick } = useVoiceInput({ appendMessage, connection, isRecording });
  const stableMicClick = useStableCallback(handleMicClick);

  /** Captures the active tab through the background; the reply resolves in useSidePanelConnection. */
  const handleCaptureScreenshot = useStableCallback(async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = activeTab?.id;
    if (tabId === undefined) throw new Error(t('errors_noActiveTab'));
    ensureConnection();
    return requestTabCapture(() => sendMessage({ type: 'capture_visible_tab', tabId }));
  });

  const handleNewChat = useStableCallback(() => {
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
  });

  const handleSchedule = useCallback((prompt: string) => setSchedulePrompt(prompt), []);
  const openSettings = useCallback(() => setShowSettings(true), [setShowSettings]);
  const handleExportReport = useStableCallback((format: 'html' | 'markdown') => {
    if (!currentSessionId) return;
    exportSessionReport(currentSessionId, format === 'html' ? 'html' : 'markdown').catch(error =>
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('report_exportFailed', error instanceof Error ? error.message : String(error)),
        timestamp: Date.now(),
      }),
    );
  });

  const handleTogglePause = () => {
    sendMessage({ type: isPaused ? 'resume_task' : 'pause_task' });
    setIsPaused(!isPaused);
  };

  // Manual takeover is a pause the user labels as "I am doing this step"; the background pause does the work.
  const handleTakeOver = () => {
    sendMessage({ type: 'pause_task' });
    setIsPaused(true);
    setTakeover({ source: 'user', message: '' });
  };

  const handleReturnToAgent = () => {
    sendMessage({ type: 'resume_task' });
    setIsPaused(false);
    setTakeover(null);
  };

  // The answer goes to the waiting ask_user action and is added to the chat as the user's message.
  const handleAnswerQuestion = (answer: string) => {
    sendMessage({ type: 'answer_question', text: answer });
    setQuestion(null);
    void appendMessage({ actor: Actors.USER, content: answer, timestamp: Date.now() }, sessionIdRef.current);
  };

  const handleSuggestion = useStableCallback((_mode: AssistantMode, prompt: string) => {
    setInputText(prompt);
  });

  const handleExecutePlan = useStableCallback((planAnswer: string) => {
    workspace.setMode('act');
    setInputText(copy.executePlan + ':\n\n' + planAnswer);
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  // The plan answer itself is read by ConversationArea, so this component does not subscribe to the messages.
  const planAnswerStreamId = workspace.mode === 'plan' && !showStopButton ? planStreamId : null;

  return (
    <div data-locale={currentLocale} className="assistant-shell">
      <AssistantHeader
        showHistory={showHistory}
        showStopButton={showStopButton}
        theme={theme}
        onCycleTheme={stableCycleTheme}
        onBackToChat={stableBackToChat}
        onNewChat={handleNewChat}
        onLoadHistory={stableLoadHistory}
        hasSession={Boolean(currentSessionId)}
        onExportReport={handleExportReport}
        onOpenSettings={openSettings}
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
          <WorkflowRecordControl sendMessage={sendMessage} ensureConnection={ensureConnection} />
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
            planStreamId={planAnswerStreamId}
            onExecutePlan={handleExecutePlan}
            onContinue={handleContinue}
            welcome={
              <WelcomeScreen
                copy={copy}
                hasConfiguredModels={hasConfiguredModels === true}
                favoritePrompts={favoritePrompts}
                bookmarkHandlers={bookmarkHandlers}
                onSuggestionSelect={handleSuggestion}
                onOpenOptions={openOptionsPage}
              />
            }
          />
          {showStopButton && takeover ? (
            <TakeoverBanner copy={copy} takeover={takeover} onReturnToAgent={handleReturnToAgent} />
          ) : null}
          {showStopButton && question ? (
            <QuestionBanner copy={copy} question={question} onAnswer={handleAnswerQuestion} />
          ) : null}
          {showStopButton ? (
            <TaskStatusBar
              copy={copy}
              mode={workspace.mode}
              isPaused={isPaused}
              isStopping={isStopping}
              lastEvent={lastEvent}
              onTogglePause={handleTogglePause}
              onTakeOver={handleTakeOver}
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
            onSendMessage={sendComposerMessage}
            savedPrompts={favoritePrompts}
            onNewChat={handleNewChat}
            onCaptureScreenshot={handleCaptureScreenshot}
            onSchedule={handleSchedule}
            onStopTask={stopComposerTask}
            onMicToggle={stableMicClick}
            onRegisterInputSetter={registerInputSetter}
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
      {schedulePrompt !== null ? (
        <ScheduleDialog
          initialPrompt={schedulePrompt}
          initialMode={workspace.mode}
          initialStartUrl={workspace.selectedTabs[0]?.url ?? ''}
          onClose={() => setSchedulePrompt(null)}
          onSaved={nextRunAt => {
            setSchedulePrompt(null);
            appendMessage({
              actor: Actors.SYSTEM,
              content: t('chat_schedule_saved', new Date(nextRunAt).toLocaleString()),
              timestamp: Date.now(),
            });
          }}
        />
      ) : null}
      {showSetupRequiredModal ? (
        <SetupRequiredModal onClose={() => setShowSetupRequiredModal(false)} onOpenSettings={openOptionsPage} />
      ) : null}
    </div>
  );
};

export default SidePanel;
