import type { AssistantAttachment } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';
import type { AssistantWorkspace } from '../hooks/useAssistantWorkspace';

interface SavedPrompt {
  id: number;
  title: string;
  content: string;
}
import ChatInput from './ChatInput';
import ManagedPolicyNotice from './ManagedPolicyNotice';
import ModelControls from './ModelControls';
import PageContext from './PageContext';

interface ComposeAreaProps {
  copy: ReturnType<typeof assistantCopy>;
  workspace: AssistantWorkspace;
  inputEnabled: boolean;
  hasConfiguredModels: boolean | null;
  showStopButton: boolean;
  isRecording: boolean;
  isProcessingSpeech: boolean;
  onSendMessage: (text: string, displayText?: string, attachments?: AssistantAttachment[]) => Promise<boolean>;
  onStopTask: () => void;
  onMicToggle: () => void;
  onRegisterInputSetter: (setter: (text: string) => void) => void;
  /** Set when the open past session can be replayed; the replay runs through the /replay command. */
  replaySessionId: string | null;
  savedPrompts: SavedPrompt[];
  onNewChat: () => void;
  onCaptureScreenshot: () => Promise<string>;
}

export default function ComposeArea({
  copy,
  workspace,
  inputEnabled,
  hasConfiguredModels,
  showStopButton,
  isRecording,
  isProcessingSpeech,
  onSendMessage,
  onStopTask,
  onMicToggle,
  onRegisterInputSetter,
  replaySessionId,
  savedPrompts,
  onNewChat,
  onCaptureScreenshot,
}: ComposeAreaProps) {
  const chatInputAction = showStopButton
    ? { type: 'stop' as const, onStopTask }
    : replaySessionId
      ? {
          type: 'replay' as const,
          historicalSessionId: replaySessionId,
          onReplay: (sessionId: string) => void onSendMessage(`/replay ${sessionId}`),
        }
      : { type: 'send' as const };

  const chatInputVoice = isProcessingSpeech
    ? ({ type: 'processing' } as const)
    : ({
        type: isRecording ? 'recording' : 'idle',
        onToggle: onMicToggle,
      } as const);

  return (
    <div className="assistant-compose-area">
      <PageContext
        tabs={workspace.tabs}
        selectedTabs={workspace.selectedTabs}
        onToggle={workspace.toggleTab}
        onUseActive={workspace.followActiveTab}
        followActive={workspace.followActive}
        disabled={showStopButton}
        copy={copy}
      />
      {workspace.error ? (
        <p className="text-xs text-destructive" role="alert">
          {workspace.error}
        </p>
      ) : null}
      <ManagedPolicyNotice />
      <ChatInput
        onSendMessage={onSendMessage}
        voice={chatInputVoice}
        disabled={!inputEnabled || !hasConfiguredModels}
        placeholder={copy.composer}
        footer={<ModelControls copy={copy} workspace={workspace} showStopButton={showStopButton} />}
        action={chatInputAction}
        setContent={onRegisterInputSetter}
        mentionTabs={workspace.tabs}
        onMentionTab={workspace.addTab}
        savedPrompts={savedPrompts}
        onNewChat={onNewChat}
        onCaptureScreenshot={onCaptureScreenshot}
      />
      <p className="assistant-composer-caption">
        {workspace.mode === 'act' ? copy.actOnly : workspace.mode === 'plan' ? copy.planHint : copy.readOnly}
      </p>
    </div>
  );
}
