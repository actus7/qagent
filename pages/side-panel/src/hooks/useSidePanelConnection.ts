import { useCallback, useRef, type MutableRefObject } from 'react';
import { t } from '@extension/i18n';
import { Actors, type Message } from '@extension/storage';
import { EventType, type AgentEvent } from '@src/types/event';
import {
  type BrowserFramePayload,
  type BrowserStatusPayload,
  isSidePanelResponseMessage,
  SIDE_PANEL_CONNECTION_PORT_NAME,
  type ExecutionPortEventMessage,
  type SidePanelCommandMessage,
} from '@src/types/port';

interface UseSidePanelConnectionArgs {
  appendMessage: (message: Message) => void;
  handleTaskStateRef: MutableRefObject<(event: AgentEvent) => void>;
  toAgentEvent: (message: ExecutionPortEventMessage) => AgentEvent | null;
  chatDebugModeRef: MutableRefObject<boolean>;
  setInputEnabled: (value: boolean) => void;
  setShowStopButton: (value: boolean) => void;
  setIsProcessingSpeech: (value: boolean) => void;
  setInputText: (text: string) => void;
  setBrowserFrame: (frame: BrowserFramePayload | null) => void;
  setBrowserStatus: (status: BrowserStatusPayload) => void;
}

const formatDebugPayload = (label: string, payload: unknown) => {
  return [`[DEBUG] ${label}`, JSON.stringify(payload, null, 2)].join('\n');
};

export const useSidePanelConnection = ({
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
}: UseSidePanelConnectionArgs) => {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);

  const appendDebugMessage = useCallback(
    (label: string, payload: unknown, actor: Actors = Actors.SYSTEM) => {
      if (!chatDebugModeRef.current) {
        return;
      }

      appendMessage({
        actor,
        content: formatDebugPayload(label, payload),
        timestamp: Date.now(),
      });
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
          handleTaskStateRef.current(event);
        } else if (message.type === 'debug_log') {
          appendDebugMessage(
            `background.${message.entry?.namespace ?? 'unknown'}.${message.entry?.level ?? 'log'}`,
            message.entry ?? message,
          );
        } else if (message.type === 'browser_frame') {
          setBrowserFrame(message.frame);
        } else if (message.type === 'browser_status') {
          setBrowserStatus(message.status);
        } else if (message.type === 'error') {
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
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
          appendDebugMessage('connection.heartbeat.ack', message);
        } else {
          appendDebugMessage('connection.message.unhandled', message);
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        appendDebugMessage('connection.closed', {
          reason: error?.message ?? 'port disconnected',
        });
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setBrowserStatus({ connected: false, authenticated: false, message: 'Port disconnected' });
        setBrowserFrame(null);
        setInputEnabled(true);
        setShowStopButton(false);
      });

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === SIDE_PANEL_CONNECTION_PORT_NAME) {
          try {
            appendDebugMessage('connection.heartbeat.sent', { type: 'heartbeat' });
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            appendDebugMessage('connection.heartbeat.failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            stopConnection();
          }
        } else {
          stopConnection();
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
