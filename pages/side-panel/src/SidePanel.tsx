import { useEffect, useCallback, useRef, useState } from 'react';
import { FiSettings, FiSun, FiMoon, FiMonitor } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import { type Message, Actors, chatHistoryStore, agentModelStore, generalSettingsStore } from '@extension/storage';
import { t } from '@extension/i18n';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import BookmarkList from './components/BookmarkList';
import { EventType, AgentEvent, ExecutionState } from './types/event';
import { Button } from '@src/components/ui/button';
import { ScrollArea } from '@src/components/ui/scroll-area';
import { useTheme } from '@extension/shared';
import { useLanguage } from '@src/context/LanguageContext';
import SettingsModal from './components/SettingsModal';
import SetupRequiredModal from './components/SetupRequiredModal';
import BrowserPreview from './components/BrowserPreview';
import { useSidePanelActions, useSidePanelState } from './hooks/useSidePanelSelectors';
import { useHistoryHandlers } from './hooks/useHistoryHandlers';
import { useFavoritePromptHandlers } from './hooks/useFavoritePromptHandlers';
import { useSidePanelConnection } from './hooks/useSidePanelConnection';
import type { BrowserFramePayload, BrowserInputPayload, BrowserStatusPayload, ExecutionPortEventMessage } from './types/port';

// Declare chrome API types
declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

const formatDebugEvent = (event: AgentEvent) => {
  const stepNumber = typeof event.data?.step === 'number' ? event.data.step + 1 : null;
  const payload = {
    type: event.type,
    actor: event.actor,
    state: event.state,
    timestamp: event.timestamp,
    data: event.data,
  };

  return [
    `[DEBUG] ${event.actor}.${event.state} | step ${stepNumber ?? '-'} / ${event.data?.maxSteps ?? '-'}`,
    JSON.stringify(payload, null, 2),
  ].join('\n');
};

const isValidActor = (value: string): value is Actors => {
  return Object.values(Actors).includes(value as Actors);
};

const isValidExecutionState = (value: string): value is ExecutionState => {
  return Object.values(ExecutionState).includes(value as ExecutionState);
};

const toAgentEvent = (message: ExecutionPortEventMessage): AgentEvent | null => {
  if (!isValidActor(message.actor) || !isValidExecutionState(message.state)) {
    return null;
  }

  return new AgentEvent(message.actor, message.state, message.data, message.timestamp, EventType.EXECUTION);
};

const SidePanel = () => {
  // BrowserManager companion is the only supported engine.
  const isAgentBrowserEngine = true;
  const { currentLocale } = useLanguage();
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
    isReplaying,
    replayEnabled,
    chatDebugMode,
    showSetupRequiredModal,
  } = useSidePanelState();

  const {
    setMessages,
    setInputEnabled,
    setShowStopButton,
    setShowSettings,
    setCurrentSessionId,
    setShowHistory,
    setChatSessions,
    setIsFollowUpMode,
    setIsHistoricalSession,
    setFavoritePrompts,
    setHasConfiguredModels,
    setIsRecording,
    setIsProcessingSpeech,
    setIsReplaying,
    setReplayEnabled,
    setChatDebugMode,
    setShowSetupRequiredModal,
    resetChatView,
  } = useSidePanelActions();
  const sessionIdRef = useRef<string | null>(null);
  const isReplayingRef = useRef<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const handleTaskStateRef = useRef<(event: AgentEvent) => void>(() => {});
  const chatDebugModeRef = useRef<boolean>(false);
  const [browserFrame, setBrowserFrame] = useState<BrowserFramePayload | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatusPayload | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const lastSettingsRefreshRef = useRef<number>(0);

  const { theme, cycleTheme } = useTheme();

  const ThemeIcon = theme === 'dark' ? FiMoon : theme === 'light' ? FiSun : FiMonitor;

  const setInputText = useCallback((text: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(text);
    }
  }, []);

  const {
    handleLoadHistory,
    handleBackToChat,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
  } = useHistoryHandlers({
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

  const {
    handleBookmarkSelect,
    handleBookmarkUpdateTitle,
    handleBookmarkDelete,
    handleBookmarkReorder,
  } = useFavoritePromptHandlers({
    currentLocale,
    setFavoritePrompts,
    setInputText,
  });

  // Check if models are configured
  const checkModelConfiguration = useCallback(async () => {
    try {
      const configuredAgents = await agentModelStore.getConfiguredAgents();

      // Check if at least one agent (preferably Navigator) is configured
      const hasAtLeastOneModel = configuredAgents.length > 0;
      setHasConfiguredModels(hasAtLeastOneModel);
    } catch (error) {
      console.error('Error checking model configuration:', error);
      setHasConfiguredModels(false);
    }
  }, [setHasConfiguredModels]);

  // Load general settings to check if replay is enabled
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
      setChatDebugMode(settings.chatDebugMode);
    } catch (error) {
      console.error('Error loading general settings:', error);
      setReplayEnabled(false);
      setChatDebugMode(false);
    }
  }, [setChatDebugMode, setReplayEnabled]);

  const refreshConfigurationAndSettings = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastSettingsRefreshRef.current < 750) {
        return;
      }

      lastSettingsRefreshRef.current = now;
      await Promise.all([checkModelConfiguration(), loadGeneralSettings()]);
    },
    [checkModelConfiguration, loadGeneralSettings],
  );

  const handleChatDebugModeChange = useCallback(
    async (enabled: boolean) => {
      setChatDebugMode(enabled);
      try {
        await generalSettingsStore.updateSettings({ chatDebugMode: enabled });
      } catch (error) {
        console.error('Failed to update chat debug mode:', error);
        setChatDebugMode(!enabled);
      }
    },
    [setChatDebugMode],
  );

  // Check model configuration on mount
  useEffect(() => {
    void refreshConfigurationAndSettings(true);
  }, [refreshConfigurationAndSettings]);

  // React immediately to model configuration changes made in other extension pages (e.g. Options).
  useEffect(() => {
    const unsubscribe = agentModelStore.subscribe(() => {
      void checkModelConfiguration();
    });
    return unsubscribe;
  }, [checkModelConfiguration]);

  useEffect(() => {
    if (hasConfiguredModels === false) {
      setShowSetupRequiredModal(true);
      return;
    }

    if (hasConfiguredModels === true) {
      setShowSetupRequiredModal(false);
    }
  }, [hasConfiguredModels, setShowSetupRequiredModal]);

  // Re-check model configuration when the side panel becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshConfigurationAndSettings();
      }
    };

    const handleFocus = () => {
      if (!document.hidden) {
        void refreshConfigurationAndSettings();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshConfigurationAndSettings]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  const appendMessage = useCallback((newMessage: Message, sessionId?: string | null) => {
    // Don't save progress messages
    const isProgressMessage = newMessage.content === progressMessage;

    setMessages(prev => {
      const filteredMessages = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
      return [...filteredMessages, newMessage];
    });

    // Use provided sessionId if available, otherwise fall back to sessionIdRef.current
    const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

    // Save message to storage if we have a session and it's not a progress message
    if (effectiveSessionId && !isProgressMessage) {
      chatHistoryStore
        .addMessage(effectiveSessionId, newMessage)
        .catch(err => console.error('Failed to save message to history:', err));
    }
  }, [progressMessage, setMessages]);

  const { ensureConnection, stopConnection, sendMessage } = useSidePanelConnection({
    appendMessage,
    handleTaskStateRef,
    toAgentEvent,
    chatDebugModeRef,
    setInputEnabled,
    setShowStopButton,
    setIsProcessingSpeech,
    setInputText,
    setBrowserFrame,
    setBrowserStatus,
  });

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

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      const content = data?.details;
      let skip = true;
      let displayProgress = false;

      switch (actor) {
        case Actors.SYSTEM:
          switch (state) {
            case ExecutionState.TASK_START:
              // Reset historical session flag when a new task starts
              setIsHistoricalSession(false);
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              skip = false;
              break;
            case ExecutionState.TASK_PAUSE:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              skip = false;
              break;
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('Invalid task state', state);
              return;
          }
          break;
        case Actors.USER:
          break;
        case Actors.PLANNER:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            case ExecutionState.STEP_CANCEL:
              break;
            default:
              console.error('Invalid step state', state);
              return;
          }
          break;
        case Actors.NAVIGATOR:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              displayProgress = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              displayProgress = false;
              break;
            case ExecutionState.STEP_CANCEL:
              displayProgress = false;
              break;
            case ExecutionState.ACT_START:
              if (content !== 'cache_content') {
                // skip to display caching content
                skip = false;
              }
              break;
            case ExecutionState.ACT_OK:
              skip = !isReplayingRef.current;
              break;
            case ExecutionState.ACT_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid action', state);
              return;
          }
          break;
        case Actors.VALIDATOR:
          // Handle legacy validator events from historical messages
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid validation', state);
              return;
          }
          break;
        default:
          console.error('Unknown actor', actor);
          return;
      }

      if (!skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
        });
      }

      if (displayProgress) {
        appendMessage({
          actor,
          content: progressMessage,
          timestamp: timestamp,
        });
      }

      if (chatDebugMode) {
        appendMessage({
          actor,
          content: formatDebugEvent(event),
          timestamp: timestamp,
        });
      }
    },
    [
      appendMessage,
      chatDebugMode,
      progressMessage,
      setInputEnabled,
      setIsFollowUpMode,
      setIsHistoricalSession,
      setIsReplaying,
      setShowStopButton,
    ],
  );

  useEffect(() => {
    handleTaskStateRef.current = handleTaskState;
  }, [handleTaskState]);

  useEffect(() => {
    chatDebugModeRef.current = chatDebugMode;
  }, [chatDebugMode]);

  // Handle replay command
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
      const newSession = await chatHistoryStore.createSession(`${t('chat_replay_prefix')}${historySessionId.substring(0, 20)}...`);

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

      const userMessage = {
        actor: Actors.USER,
        content: `/replay ${historySessionId}`,
        timestamp: Date.now(),
      };

      // Add the user message to the new session
      appendMessage(userMessage, sessionIdRef.current);

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

  // Handle chat commands that start with /
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      ensureConnection();

      // Handle different commands
      if (command === '/state') {
        await sendMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        await sendMessage({
          type: 'nohighlight',
        });
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

        const historySessionId = parts[1];
        await handleReplay(historySessionId);
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

  const handleSendMessage = async (text: string, displayText?: string) => {
    // Trim the input text first
    const trimmedText = text.trim();

    if (!trimmedText) return;

    // Check if the input is a command (starts with /)
    if (trimmedText.startsWith('/')) {
      // Process command and return if it was handled
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      setInputEnabled(false);
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      if (!isFollowUpMode) {
        // Use display text for session title if available, otherwise use full text
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );

        // Store the session ID in both state and ref
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      const userMessage = {
        actor: Actors.USER,
        content: displayText || text, // Use display text for chat UI, full text for background service
        timestamp: Date.now(),
      };

      // Pass the sessionId directly to appendMessage
      appendMessage(userMessage, sessionIdRef.current);

      const taskId = sessionIdRef.current;
      if (!taskId) {
        throw new Error('Task session ID is not available');
      }

      ensureConnection();

      // Send message using the utility function
      if (isFollowUpMode) {
        // Send as follow-up task
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId,
          tabId,
        });
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId,
          tabId,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleStopTask = async () => {
    try {
      await sendMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('cancel_task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setInputEnabled(true);
    setShowStopButton(false);
  };

  const handleNewChat = () => {
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
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  // Scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear the timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // If permission is not granted, open permission page
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // Open permission page in a new window
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // Listen for window close to check permission status
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // Check permission status after window closes
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // Only retry if permission was granted
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // If denied or prompt, do nothing - let user manually try again
                    } catch (error) {
                      console.error('Failed to check permission status:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // Permission granted - proceed with recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Clear previous audio chunks
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            ensureConnection();

            // Send audio to backend for speech-to-text conversion
            try {
              setIsProcessingSpeech(true);
              sendMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('Failed to send audio for speech-to-text:', error);
              appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_processingFailed'),
                timestamp: Date.now(),
              });
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // Set up 2-minute duration limit
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

  const chatInputAction = showStopButton
    ? { type: 'stop' as const, onStopTask: handleStopTask }
    : isHistoricalSession && replayEnabled && currentSessionId
      ? { type: 'replay' as const, historicalSessionId: currentSessionId, onReplay: handleReplay }
      : { type: 'send' as const };

  const chatInputVoice =
    isProcessingSpeech
      ? ({ type: 'processing' } as const)
      : ({
          type: isRecording ? 'recording' : 'idle',
          onToggle: handleMicClick,
        } as const);

  return (
    <div>
      <div
        data-locale={currentLocale}
        className="relative flex h-screen flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center">
            {showHistory ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleBackToChat(false)}
                className="hover:text-primary/80 text-primary"
                aria-label={t('nav_back_a11y')}>
                {t('nav_back')}
              </Button>
            ) : (
              <img src="/icon-128.png" alt="Extension Logo" className="size-6" />
            )}
          </div>
          <div className="flex items-center gap-1">
            {!showHistory && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  className="hover:text-primary/80 size-8 text-primary"
                  aria-label={t('nav_newChat_a11y')}>
                  <PiPlusBold size={18} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLoadHistory}
                  className="hover:text-primary/80 size-8 text-primary"
                  aria-label={t('nav_loadHistory_a11y')}>
                  <GrHistory size={18} />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={cycleTheme}
              className="hover:text-primary/80 size-8 text-primary"
              aria-label={`Theme: ${theme}`}
              title={`Theme: ${theme}`}>
              <ThemeIcon size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="hover:text-primary/80 size-8 text-primary"
              aria-label={t('nav_settings_a11y')}>
              <FiSettings size={18} />
            </Button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
            />
          </div>
        ) : (
          <>
            {/* Loading state */}
            {hasConfiguredModels === null && (
              <div className="flex flex-1 items-center justify-center p-8 text-primary">
                <div className="text-center">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p>{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {hasConfiguredModels === false ? <div className="flex-1" /> : null}

            {/* Chat interface */}
            {hasConfiguredModels === true && (
              <>
                {isAgentBrowserEngine && (
                  <BrowserPreview
                    frame={browserFrame}
                    status={browserStatus}
                    sessionId={currentSessionId}
                    disabled={!inputEnabled}
                    onInput={handleBrowserInput}
                  />
                )}
                {messages.length === 0 && (
                  <>
                    <div className="mb-2 border-t border-border p-2">
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        voice={chatInputVoice}
                        disabled={!inputEnabled || isHistoricalSession}
                        action={chatInputAction}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                      />
                    </div>
                    <ScrollArea className="flex-1">
                      <BookmarkList
                        bookmarks={favoritePrompts}
                        onBookmarkSelect={handleBookmarkSelect}
                        onBookmarkUpdateTitle={handleBookmarkUpdateTitle}
                        onBookmarkDelete={handleBookmarkDelete}
                        onBookmarkReorder={handleBookmarkReorder}
                      />
                    </ScrollArea>
                  </>
                )}
                {messages.length > 0 ? (
                  <ScrollArea className="flex-1 p-2">
                    <MessageList messages={messages} />
                    <div ref={messagesEndRef} />
                  </ScrollArea>
                ) : null}
                {messages.length > 0 ? (
                  <div className="border-t border-border p-2">
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      voice={chatInputVoice}
                      disabled={!inputEnabled || isHistoricalSession}
                      action={chatInputAction}
                      setContent={setter => {
                        setInputTextRef.current = setter;
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
        {showSettings && (
          <SettingsModal
            chatDebugMode={chatDebugMode}
            onClose={() => setShowSettings(false)}
            onChatDebugModeChange={handleChatDebugModeChange}
          />
        )}
        {showSetupRequiredModal && (
          <SetupRequiredModal
            onClose={() => setShowSetupRequiredModal(false)}
            onOpenSettings={() => {
              chrome.runtime.openOptionsPage();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default SidePanel;
