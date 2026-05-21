import { useState, useRef, useEffect, useCallback } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';
import { Textarea } from '@src/components/ui/textarea';
import { Badge } from '@src/components/ui/badge';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => void;
  voice?:
    | { type: 'idle'; onToggle: () => void }
    | { type: 'recording'; onToggle: () => void }
    | { type: 'processing' };
  disabled: boolean;
  setContent?: (setter: (text: string) => void) => void;
  action:
    | { type: 'send' }
    | { type: 'stop'; onStopTask: () => void }
    | { type: 'replay'; historicalSessionId: string; onReplay: (sessionId: string) => void };
}

interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

const ALLOWED_ATTACHMENT_TYPES = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.log',
  '.xml',
  '.yaml',
  '.yml',
]);

export default function ChatInput({
  onSendMessage,
  voice,
  disabled,
  setContent,
  action,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const isSendButtonDisabled = disabled || (text.trim() === '' && attachedFiles.length === 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  };

  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedText = text.trim();

      if (trimmedText || attachedFiles.length > 0) {
        let messageContent = trimmedText;
        let displayContent = trimmedText;

        if (attachedFiles.length > 0) {
          const fileContents = attachedFiles
            .map(file => {
              return `\n\n<nano_file_content type="file" name="${file.name}">\n${file.content}\n</nano_file_content>`;
            })
            .join('\n');

          messageContent = trimmedText
            ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
            : `<nano_attached_files>${fileContents}</nano_attached_files>`;

          const fileList = attachedFiles.map(file => `📎 ${file.name}`).join('\n');
          displayContent = trimmedText ? `${trimmedText}\n\n${fileList}` : fileList;
        }

        onSendMessage(messageContent, displayContent);
        setText('');
        setAttachedFiles([]);
      }
    },
    [text, attachedFiles, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const candidates = Array.from(files).filter(file => {
      const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;

      if (!ALLOWED_ATTACHMENT_TYPES.has(extension)) {
        console.warn(`File type ${extension} not supported. Only text-based files are allowed.`);
        return false;
      }

      if (file.size > 1024 * 1024) {
        console.warn(`File ${file.name} is too large. Maximum size is 1MB.`);
        return false;
      }

      return true;
    });

    const newFiles = (
      await Promise.all(
        candidates.map(async file => {
          try {
            const content = await file.text();
            return {
              name: file.name,
              content,
              type: file.type || 'text/plain',
            } as AttachedFile;
          } catch (error) {
            console.error(`Error reading file ${file.name}:`, error);
            return null;
          }
        }),
      )
    ).filter((file): file is AttachedFile => file !== null);

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const isVoiceRecording = voice?.type === 'recording';
  const isVoiceProcessing = voice?.type === 'processing';
  const voiceLabel = isVoiceProcessing
    ? t('chat_stt_processing')
    : isVoiceRecording
      ? t('chat_stt_recording_stop')
      : t('chat_stt_input_start');

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-lg border border-border bg-card transition-colors ${disabled ? 'cursor-not-allowed' : 'focus-within:border-primary hover:border-primary'}`}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* File attachments display */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border bg-muted p-2">
            {attachedFiles.map((file, index) => (
              <Badge key={index} variant="secondary" className="flex items-center gap-1 pr-1">
                <span className="text-xs">📎</span>
                <span className="max-w-[150px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(index)}
                  className="hover:bg-muted-foreground/20 ml-1 rounded-sm transition-colors"
                  aria-label={t('chat_input_removeFile', file.name)}>
                  <span className="text-xs">✕</span>
                </button>
              </Badge>
            ))}
          </div>
        )}

        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          rows={5}
          className="w-full resize-none border-none bg-card p-2 shadow-none focus-visible:ring-0"
          placeholder={attachedFiles.length > 0 ? t('chat_input_placeholder_withAttachments') : t('chat_input_placeholder')}
          aria-label={t('chat_input_editor')}
        />

        <div className="flex items-center justify-between bg-card px-2 py-1.5">
          <div className="flex gap-2 text-muted-foreground">
            {/* File attachment button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleFileSelect}
              disabled={disabled}
              aria-label={t('chat_input_attachFiles')}
              title={t('chat_input_attachFiles_title')}
              className="size-8">
              <span className="text-lg">📎</span>
            </Button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />

            {voice && (
              <Button
                type="button"
                variant={isVoiceRecording ? 'destructive' : 'ghost'}
                size="icon"
                onClick={voice.type === 'processing' ? undefined : voice.onToggle}
                disabled={disabled || isVoiceProcessing}
                aria-label={voiceLabel}
                className="size-8">
                {isVoiceProcessing ? (
                  <AiOutlineLoading3Quarters className="size-4 animate-spin" />
                ) : (
                  <FaMicrophone className={`size-4 ${isVoiceRecording ? 'animate-pulse' : ''}`} />
                )}
              </Button>
            )}
          </div>

          {action.type === 'stop' ? (
            <Button type="button" variant="destructive" size="sm" onClick={action.onStopTask}>
              {t('chat_buttons_stop')}
            </Button>
          ) : action.type === 'replay' ? (
            <Button
              type="button"
              size="sm"
              onClick={() => action.onReplay(action.historicalSessionId)}
              className="hover:bg-primary/90 bg-primary text-primary-foreground">
              {t('chat_buttons_replay')}
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className="hover:bg-primary/90 bg-primary text-primary-foreground">
              {t('chat_buttons_send')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
