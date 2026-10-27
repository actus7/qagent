import { useCallback, useRef, type MutableRefObject } from 'react';
import { t } from '@extension/i18n';
import { Actors, type Message } from '@extension/storage';
import { EventType, ExecutionState, type AgentEvent } from '@src/types/event';
import { rejectTabCapture, resolveTabCapture } from '@src/lib/tab-capture';
import { publishWorkflowRecording } from '@src/store/workflowRecordingStore';
import {
  type BrowserFramePayload,
  type BrowserStatusPayload,
  isSidePanelResponseMessage,
  SIDE_PANEL_CONNECTION_PORT_NAME,
  type ExecutionPortEventMessage,
  type SidePanelCommandMessage,
  type SidePanelResponseMessage,
} from '@src/types/port';

// Debug cards are shown, never stored: persisting each one rewrote the whole session per log line.
const MAX_DEBUG_CARDS = 300;

interface UseSidePanelConnectionArgs {
  /** `sessionId: null` shows the message without saving it to the chat history. */
  appendMessage: (message: Message, sessionId?: string | null) => void;
  handleTaskStateRef: MutableRefObject<(event: AgentEvent) => void>;
  toAgentEvent: (message: ExecutionPortEventMessage) => AgentEvent | null;
  chatDebugModeRef: MutableRefObject<boolean>;
  isTaskRunningRef: MutableRefObject<boolean>;
  setInputEnabled: (value: boolean) => void;
  setShowStopButton: (value: boolean) => void;
  setIsProcessingSpeech: (value: boolean) => void;
  setInputText: (text: string) => void;
  setBrowserFrame: (frame: BrowserFramePayload | null) => void;
  setBrowserStatus: (status: BrowserStatusPayload) => void;
  onAssistantMessage: (message: SidePanelResponseMessage) => void;
  resetRunState: () => void;
}

const formatDebugPayload = (label: string, payload: unknown) => {
  return [`[DEBUG] ${label}`, JSON.stringify(payload, null, 2)].join('\n');
};

export const useSidePanelConnection = ({
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
  onAssistantMessage,
  resetRunState,
}: UseSidePanelConnectionArgs) => {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const debugCardCountRef = useRef(0);

  const appendDebugMessage = useCallback(
    (label: string, payload: unknown, actor: Actors = Actors.SYSTEM) => {
      if (!chatDebugModeRef.current || debugCardCountRef.current >= MAX_DEBUG_CARDS) {
        return;
      }
      debugCardCountRef.current += 1;

      appendMessage(
        {
          actor,
          content: formatDebugPayload(label, payload),
          timestamp: Date.now(),
        },
        null,
      );
    },
    [appendMessage, chatDebugModeRef],
  );

  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  const ensureConnection = useCallback(() => {
    if (portRef.current) {
      return;
    }

    try {
      portRef.current = chrome.runtime.connect({ name: SIDE_PANEL_CONNECTION_PORT_NAME });
      appendDebugMessage('connection.open', { name: SIDE_PANEL_CONNECTION_PORT_NAME });

      portRef.current.onMessage.addListener((incomingMessage: unknown) => {
        if (!isSidePanelResponseMessage(incomingMessage)) {
          appendDebugMessage('connection.message.invalid', incomingMessage);
          return;
        }

        const message = incomingMessage;
        if (message.type === 'assistant_delta') {
          onAssistantMessage(message);
          return;
        }
        if (
          message.type !== EventType.EXECUTION &&
          message.type !== 'heartbeat_ack' &&
          message.type !== 'debug_log' &&
          message.type !== 'browser_frame'
        ) {
          appendDebugMessage('connection.message.incoming', message);
        }

        if (message.type === EventType.EXECUTION) {
          const event = toAgentEvent(message);
          if (!event) {
            appendDebugMessage('connection.message.invalidExecutionEvent', message);
            return;
          }
          // Each task gets its own debug-card budget, so the end-of-task timing log is always shown.
          if (event.state === ExecutionState.TASK_START) debugCardCountRef.current = 0;
          handleTaskStateRef.current(event);
        } else if (message.type === 'debug_log') {
          appendDebugMessage(
            `background.${message.entry?.namespace ?? 'unknown'}.${message.entry?.level ?? 'log'}`,
            message.entry ?? message,
          );
        } else if (message.type === 'browser_frame') {
          setBrowserFrame(message.frame);
        } else if (message.type === 'workflow_recording') {
          publishWorkflowRecording(message.snapshot);
        } else if (message.type === 'browser_status') {
          setBrowserStatus(message.status);
        } else if (message.type === 'tab_capture') {
          resolveTabCapture(message.dataUrl);
        } else if (message.type === 'error') {
          rejectTabCapture(message.error);
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          // An error does not end a running task; its TASK_OK/TASK_FAIL/TASK_CANCEL event does
          if (!isTaskRunningRef.current) {
            setInputEnabled(true);
            setShowStopButton(false);
          }
        } else if (message.type === 'success') {
          if (message.msg) {
            appendMessage({
              actor: Actors.SYSTEM,
              content: message.msg,
              timestamp: Date.now(),
            });
          }
        } else if (message.type === 'speech_to_text_result') {
          if (message.text) {
            setInputText(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message.type === 'speech_to_text_error') {
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('chat_stt_recognitionFailed'),
            timestamp: Date.now(),
          });
          setIsProcessingSpeech(false);
        } else if (message.type === 'heartbeat_ack') {
          // Keep-alive only: a chat card every 25 s buries the real debug events
        } else {
          appendDebugMessage('connection.message.unhandled', message);
        }
      });

      // `port.disconnect()` never fires our own onDisconnect, so a heartbeat failure resets the UI through here too
      const handleConnectionLost = (reason: string) => {
        appendDebugMessage('connection.closed', { reason });
        stopConnection();
        setBrowserStatus({ connected: false, authenticated: false, message: 'Port disconnected' });
        setBrowserFrame(null);
        resetRunState();
        setInputEnabled(true);
        setShowStopButton(false);
      };

      portRef.current.onDisconnect.addListener(() => {
        handleConnectionLost(chrome.runtime.lastError?.message ?? 'port disconnected');
      });

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === SIDE_PANEL_CONNECTION_PORT_NAME) {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            handleConnectionLost(
              `heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        } else {
          handleConnectionLost('heartbeat found no open port');
        }
      }, 25000);
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendDebugMessage('connection.open.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_conn_serviceWorker'),
        timestamp: Date.now(),
      });
      portRef.current = null;
    }
  }, [
    appendDebugMessage,
    appendMessage,
    handleTaskStateRef,
    setInputEnabled,
    setInputText,
    setIsProcessingSpeech,
    setBrowserFrame,
    setBrowserStatus,
    setShowStopButton,
    stopConnection,
    toAgentEvent,
    onAssistantMessage,
    resetRunState,
    isTaskRunningRef,
  ]);

  const sendMessage = useCallback(
    (message: SidePanelCommandMessage) => {
      appendDebugMessage('connection.message.outgoing', message);
      if (portRef.current?.name !== SIDE_PANEL_CONNECTION_PORT_NAME) {
        appendDebugMessage('connection.message.outgoing.failed', {
          error: 'No valid connection available',
          message,
        });
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        appendDebugMessage('connection.message.outgoing.failed', {
          error: error instanceof Error ? error.message : String(error),
          message,
        });
        stopConnection();
        throw error;
      }
    },
    [appendDebugMessage, stopConnection],
  );

  return {
    ensureConnection,
    stopConnection,
    sendMessage,
  };
};

export type SidePanelConnection = ReturnType<typeof useSidePanelConnection>;
