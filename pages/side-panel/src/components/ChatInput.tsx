import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { FiArrowUp, FiPaperclip, FiSquare } from 'react-icons/fi';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';
import { Textarea } from '@src/components/ui/textarea';
import { Badge } from '@src/components/ui/badge';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => boolean | void | Promise<boolean | void>;
  voice?: { type: 'idle'; onToggle: () => void } | { type: 'recording'; onToggle: () => void } | { type: 'processing' };
  disabled: boolean;
  placeholder?: string;
  footer?: ReactNode;
  setContent?: (setter: (text: string) => void) => void;
  action:
    | { type: 'send' }
    | { type: 'stop'; onStopTask: () => void }
    | { type: 'replay'; historicalSessionId: string; onReplay: (sessionId: string) => void };
}

interface AttachedFile {
  id: string;
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
  placeholder,
  footer,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [fileError, setFileError] = useState('');
  const isSendButtonDisabled = disabled || (text.trim() === '' && attachedFiles.length === 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

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
  }, [text]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (disabled || action.type !== 'send' || submittingRef.current) return;
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

        submittingRef.current = true;
        try {
          const accepted = await onSendMessage(messageContent, displayContent);
          if (accepted !== false) {
            setText('');
            setAttachedFiles([]);
          }
        } finally {
          submittingRef.current = false;
        }
      }
    },
    [text, attachedFiles, onSendMessage, disabled, action.type],
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

    setFileError('');
    const candidates = Array.from(files)
      .slice(0, 5)
      .filter(file => {
        const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;

        if (!ALLOWED_ATTACHMENT_TYPES.has(extension)) {
          setFileError(`${file.name}: use TXT, Markdown, JSON, CSV, LOG, XML ou YAML.`);
          return false;
        }

        if (file.size > 1024 * 1024) {
          setFileError(`${file.name}: tamanho máximo de 1 MB.`);
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
              id: crypto.randomUUID(),
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
      setAttachedFiles(prev => [...prev, ...newFiles].slice(0, 5));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setAttachedFiles(prev => prev.filter(file => file.id !== id));
  }, []);

  const isVoiceRecording = voice?.type === 'recording';
  const isVoiceProcessing = voice?.type === 'processing';
  const voiceLabel = isVoiceProcessing
    ? t('chat_stt_processing')
    : isVoiceRecording
      ? t('chat_stt_recording_stop')
      : t('chat_stt_input_start');

  return (
    <form onSubmit={handleSubmit} className="assistant-composer" aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* File attachments display */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border bg-muted p-2">
            {attachedFiles.map(file => (
              <Badge key={file.id} variant="secondary" className="flex items-center gap-1 pr-1">
                <span className="text-xs">📎</span>
                <span className="max-w-[150px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.id)}
                  className="ml-1 rounded-sm transition-colors hover:bg-muted-foreground/20"
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
          rows={3}
          className="assistant-editor w-full resize-none border-none bg-card shadow-none focus-visible:ring-0"
          placeholder={
            attachedFiles.length > 0
              ? t('chat_input_placeholder_withAttachments')
              : (placeholder ?? t('chat_input_placeholder'))
          }
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
              <FiPaperclip size={17} />
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
              <FiSquare size={13} className="mr-1.5" />
              {t('chat_buttons_stop')}
            </Button>
          ) : action.type === 'replay' ? (
            <Button
              type="button"
              size="sm"
              onClick={() => action.onReplay(action.historicalSessionId)}
              className="bg-primary text-primary-foreground hover:bg-primary/90">
              {t('chat_buttons_replay')}
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              aria-label={t('chat_buttons_send')}
              title={t('chat_buttons_send')}
              className="bg-primary text-primary-foreground hover:bg-primary/90">
              <FiArrowUp size={18} />
            </Button>
          )}
        </div>
      </div>
      {fileError ? (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {fileError}
        </p>
      ) : null}
      {footer}
    </form>
  );
}
