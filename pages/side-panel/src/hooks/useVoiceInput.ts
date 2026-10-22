import { useEffect, useRef } from 'react';
import { Actors } from '@extension/storage';
import { t } from '@extension/i18n';
import { describeMicrophoneError, MAX_RECORDING_MS, openMicrophonePermissionWindow } from '../lib/microphone';
import type { AppendMessage } from '../lib/sidepanel-events';
import type { SidePanelConnection } from './useSidePanelConnection';
import { useSidePanelActions } from './useSidePanelSelectors';

interface UseVoiceInputArgs {
  appendMessage: AppendMessage;
  connection: SidePanelConnection;
  isRecording: boolean;
}

const MICROPHONE_PERMISSION = { name: 'microphone' as PermissionName };

/** Microphone capture for speech-to-text, including the permission prompt flow. */
export const useVoiceInput = ({ appendMessage, connection, isRecording }: UseVoiceInputArgs) => {
  const { setIsRecording, setIsProcessingSpeech } = useSidePanelActions();
  const { ensureConnection, sendMessage } = connection;
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  // Stop recording and clear the timer on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    clearRecordingTimer();
    setIsRecording(false);
  };

  const sendRecording = (audioChunks: Blob[]) => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
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
  };

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Clear previous audio chunks
    audioChunksRef.current = [];

    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      // Stop all tracks to release microphone
      stream.getTracks().forEach(track => track.stop());
      if (audioChunksRef.current.length > 0) {
        sendRecording(audioChunksRef.current);
      }
    };

    // Recording duration limit
    recordingTimerRef.current = window.setTimeout(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      setIsProcessingSpeech(true);
      recordingTimerRef.current = null;
    }, MAX_RECORDING_MS);

    mediaRecorder.start();
    setIsRecording(true);
  };

  const handleMicClick = async (): Promise<void> => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query(MICROPHONE_PERMISSION);

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // If permission is not granted, open the permission page and retry once it is granted
      if (permissionStatus.state !== 'granted') {
        openMicrophonePermissionWindow(async () => {
          try {
            const newPermissionStatus = await navigator.permissions.query(MICROPHONE_PERMISSION);
            // Only retry if permission was granted; otherwise the user can try again manually
            if (newPermissionStatus.state === 'granted') {
              void handleMicClick();
            }
          } catch (error) {
            console.error('Failed to check permission status:', error);
          }
        });
        return;
      }

      await startRecording();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: describeMicrophoneError(error),
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

  return { handleMicClick };
};
