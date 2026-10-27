import { memo, useState, useRef, useEffect, useCallback, useId, useMemo, type ReactNode } from 'react';
import { FiArrowUp, FiCamera, FiClock, FiPaperclip, FiSquare } from 'react-icons/fi';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { t } from '@extension/i18n';
import {
  ASSISTANT_MAX_FILES,
  ASSISTANT_MAX_IMAGES,
  isAssistantImageMimeType,
  slugifyCommand,
  type AssistantAttachment,
  type PixelRect,
  type SlashCommandItem,
  useLanguage,
} from '@extension/shared';
import { Button } from '@extension/ui';
import { Textarea } from '@src/components/ui/textarea';
import { Badge } from '@src/components/ui/badge';
import ComposerPopup from './ComposerPopup';
import ScreenshotCropper from './ScreenshotCropper';
import { useComposerSuggestions, type MentionSource } from '@src/hooks/useComposerSuggestions';
import {
  AttachmentReadFailure,
  cropImageDataUrl,
  prepareBinaryAttachment,
  prepareImageAttachment,
} from '@src/lib/attachment-files';

export interface SavedPrompt {
  id: number;
  title: string;
  content: string;
}

interface ChatInputProps {
  onSendMessage: (
    text: string,
    displayText?: string,
    attachments?: AssistantAttachment[],
  ) => boolean | void | Promise<boolean | void>;
  voice?: { type: 'idle'; onToggle: () => void } | { type: 'recording'; onToggle: () => void } | { type: 'processing' };
  disabled: boolean;
  placeholder?: string;
  footer?: ReactNode;
  setContent?: (setter: (text: string) => void) => void;
  action:
    | { type: 'send' }
    | { type: 'stop'; onStopTask: () => void }
    | { type: 'replay'; historicalSessionId: string; onReplay: (sessionId: string) => void };
  /** Open tabs offered by the "@" popup. */
  mentionTabs?: MentionSource[];
  onMentionTab?: (tabId: number) => void;
  /** Saved prompts offered by the "/" popup as /<slug>. */
  savedPrompts?: SavedPrompt[];
  /** Runs "/new" (typed or picked) as a new chat. */
  onNewChat?: () => void;
  /** Captures the visible area of the active tab as a PNG data URL; omit to hide the capture button. */
  onCaptureScreenshot?: () => Promise<string>;
  /** Opens the schedule dialog prefilled with the given prompt ("" for /agendar). */
  onSchedule?: (prompt: string) => void;
}

interface AttachedFile {
  id: string;
  name: string;
  content: string;
  type: string;
}

// Text files are inlined into the message (existing behaviour); any other file is sent as a binary attachment.
const TEXT_ATTACHMENT_TYPES = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.xml', '.yaml', '.yml']);
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_TEXT_FILES = 5;

const extensionOf = (name: string) => `.${name.split('.').pop()?.toLowerCase() ?? ''}`;

function describeReadError(name: string, error: unknown): string {
  if (error instanceof AttachmentReadFailure) {
    if (error.reason === 'imageUnsupported') return t('chat_input_imageUnsupported', [name]);
    if (error.reason === 'imageTooLarge') return t('chat_input_imageTooLarge', [name]);
    return t('chat_input_binaryFileTooLarge', [name]);
  }
  console.error(`Error reading file ${name}:`, error);
  return t('chat_input_readFailed', [name]);
}

/** Built-in commands first, then saved prompts. Saved prompt slugs never collide with built-ins. */
function buildSlashCommands(savedPrompts: SavedPrompt[]): SlashCommandItem[] {
  const builtIns: SlashCommandItem[] = [
    { slug: 'new', title: 'new', description: t('chat_input_cmd_new'), kind: 'builtin' },
    { slug: 'replay', title: 'replay', description: t('chat_input_cmd_replay'), kind: 'builtin' },
    { slug: 'state', title: 'state', description: t('chat_input_cmd_state'), kind: 'builtin' },
    { slug: 'nohighlight', title: 'nohighlight', description: t('chat_input_cmd_nohighlight'), kind: 'builtin' },
    { slug: 'compact', title: 'compact', description: t('chat_input_cmd_compact'), kind: 'builtin' },
    { slug: 'agendar', title: 'agendar', description: t('chat_input_cmd_schedule'), kind: 'builtin' },
  ];
  const taken = new Set(builtIns.map(command => command.slug));
  const prompts = savedPrompts.map(prompt => {
    let slug = slugifyCommand(prompt.title, `prompt-${prompt.id}`);
    if (taken.has(slug)) slug = `${slug}-${prompt.id}`;
    taken.add(slug);
    return {
      slug,
      title: prompt.title,
      description: t('chat_input_savedPrompt'),
      kind: 'prompt' as const,
      content: prompt.content,
    };
  });
  return [...builtIns, ...prompts];
}

function ChatInput({
  onSendMessage,
  voice,
  disabled,
  setContent,
  action,
  placeholder,
  footer,
  mentionTabs = [],
  onMentionTab,
  savedPrompts = [],
  onNewChat,
  onCaptureScreenshot,
  onSchedule,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [fileError, setFileError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const hasAttachments = attachedFiles.length + attachments.length > 0;
  const isSendButtonDisabled = disabled || (text.trim() === '' && !hasAttachments);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const listboxId = useId();
  const { currentLocale } = useLanguage();
  // currentLocale is a dep so the t() descriptions follow a language switch
  // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  const commands = useMemo(() => buildSlashCommands(savedPrompts), [savedPrompts, currentLocale]);

  const suggestions = useComposerSuggestions({
    text,
    caret,
    mentionTabs,
    commands,
    apply: next => {
      setText(next.text);
      setCaret(next.caret);
      requestAnimationFrame(() => textareaRef.current?.setSelectionRange(next.caret, next.caret));
    },
    onMention: tabId => onMentionTab?.(tabId),
    onCommand: command => {
      if (command.kind === 'builtin' && command.slug === 'new') onNewChat?.();
      if (command.kind === 'builtin' && command.slug === 'agendar') {
        setText('');
        onSchedule?.('');
      }
    },
  });
  const activeOptionId =
    suggestions.isOpen && suggestions.items[suggestions.activeIndex]
      ? `${listboxId}-option-${suggestions.activeIndex}`
      : undefined;

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    setCaret(e.target.selectionStart);
    // the [text] effect below resizes the textarea; doing it here too forced a second layout per keystroke
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

      if (trimmedText === '/new' && !hasAttachments) {
        setText('');
        onNewChat?.();
        return;
      }

      if (trimmedText === '/agendar' && !hasAttachments) {
        setText('');
        onSchedule?.('');
        return;
      }

      if (trimmedText || hasAttachments) {
        let messageContent = trimmedText;
        const displayParts = [trimmedText];

        if (attachedFiles.length > 0) {
          const fileContents = attachedFiles
            .map(file => {
              return `\n\n<nano_file_content type="file" name="${file.name}">\n${file.content}\n</nano_file_content>`;
            })
            .join('\n');

          messageContent = trimmedText
            ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
            : `<nano_attached_files>${fileContents}</nano_attached_files>`;

          displayParts.push(attachedFiles.map(file => `📎 ${file.name}`).join('\n'));
        }
        // Images and binary files are not inlined: the background receives them as attachments.
        // The chat history keeps only a placeholder per attachment.
        displayParts.push(
          attachments
            .map(item => (item.kind === 'image' ? t('chat_input_imageToken', [item.name]) : `📎 ${item.name}`))
            .join('\n'),
        );
        const displayContent = displayParts.filter(Boolean).join('\n\n');

        submittingRef.current = true;
        try {
          const accepted = await onSendMessage(messageContent, displayContent, attachments);
          if (accepted !== false) {
            setText('');
            setAttachedFiles([]);
            setAttachments([]);
          }
        } finally {
          submittingRef.current = false;
        }
      }
    },
    [text, attachedFiles, attachments, hasAttachments, onSendMessage, onNewChat, onSchedule, disabled, action.type],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestions.handleKeyDown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit, suggestions],
  );

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /** Routes picked, pasted or dropped files by type and enforces the per-type limits. */
  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || files.length === 0) return;
      setFileError('');
      let imageSlots = ASSISTANT_MAX_IMAGES - attachments.filter(item => item.kind === 'image').length;
      let fileSlots = ASSISTANT_MAX_FILES - attachments.filter(item => item.kind === 'file').length;
      let textSlots = MAX_TEXT_FILES - attachedFiles.length;
      const errors: string[] = [];
      const added: AssistantAttachment[] = [];
      const addedText: AttachedFile[] = [];

      for (const file of files) {
        try {
          if (isAssistantImageMimeType(file.type)) {
            if (imageSlots <= 0) {
              errors.push(t('chat_input_tooManyImages'));
              continue;
            }
            imageSlots -= 1;
            added.push(await prepareImageAttachment(file, file.name));
          } else if (TEXT_ATTACHMENT_TYPES.has(extensionOf(file.name))) {
            if (textSlots <= 0) {
              errors.push(t('chat_input_tooManyFiles'));
              continue;
            }
            if (file.size > MAX_TEXT_FILE_BYTES) {
              errors.push(t('chat_input_fileTooLarge', [file.name]));
              continue;
            }
            textSlots -= 1;
            addedText.push({
              id: crypto.randomUUID(),
              name: file.name,
              content: await file.text(),
              type: file.type || 'text/plain',
            });
          } else {
            if (fileSlots <= 0) {
              errors.push(t('chat_input_tooManyFiles'));
              continue;
            }
            fileSlots -= 1;
            added.push(await prepareBinaryAttachment(file));
          }
        } catch (error) {
          errors.push(describeReadError(file.name, error));
        }
      }

      if (added.length > 0) setAttachments(prev => [...prev, ...added]);
      if (addedText.length > 0) setAttachedFiles(prev => [...prev, ...addedText]);
      if (errors.length > 0) setFileError(errors.join(' '));
    },
    [attachments, attachedFiles, disabled],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      await addFiles(files);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [addFiles],
  );

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>) => {
    if (disabled || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDrop = (e: React.DragEvent<HTMLFormElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setIsDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const handleCapture = async () => {
    if (!onCaptureScreenshot || disabled || isCapturing) return;
    setIsCapturing(true);
    setFileError('');
    try {
      setCropSource(await onCaptureScreenshot());
    } catch (error) {
      setFileError(t('chat_input_captureFailed', [error instanceof Error ? error.message : String(error)]));
    } finally {
      setIsCapturing(false);
    }
  };

  /** rect is null for a full screenshot; the crop is downscaled like any other image. */
  const handleCropConfirm = async (rect: PixelRect | null) => {
    const source = cropSource;
    setCropSource(null);
    if (!source) return;
    // Checked first: cropping and re-encoding the screenshot is the expensive part, and it is wasted at the limit.
    if (attachments.filter(item => item.kind === 'image').length >= ASSISTANT_MAX_IMAGES) {
      setFileError(t('chat_input_tooManyImages'));
      return;
    }
    try {
      const dataUrl = rect ? await cropImageDataUrl(source, rect) : source;
      const blob = await (await fetch(dataUrl)).blob();
      const attachment = await prepareImageAttachment(blob, `screenshot-${Date.now()}.png`);
      setAttachments(prev => [...prev, attachment]);
    } catch (error) {
      setFileError(describeReadError('screenshot', error));
    }
  };

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(file => file.id !== id));
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setAttachedFiles(prev => prev.filter(file => file.id !== id));
  }, []);

  const mentionFavicons = useMemo(
    () => new Map(mentionTabs.map(tab => [String(tab.id), tab.favIconUrl])),
    [mentionTabs],
  );

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
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`assistant-composer ${isDragging ? 'ring-2 ring-primary ring-inset' : ''}`}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* Attachments display: image thumbnails, binary files and text files */}
        {hasAttachments && (
          <div className="flex flex-wrap items-start gap-2 border-b border-border bg-muted p-2">
            {attachments.map(item =>
              item.kind === 'image' ? (
                <div key={item.id} className="relative">
                  <img
                    src={item.dataUrl}
                    alt={item.name}
                    className="size-14 rounded-md border border-border bg-card object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(item.id)}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-xs shadow-sm transition-colors hover:bg-muted"
                    aria-label={t('chat_input_removeImage', [item.name])}>
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              ) : (
                <Badge key={item.id} variant="secondary" className="flex items-center gap-1 pr-1">
                  <span className="text-xs">📎</span>
                  <span className="max-w-[150px] truncate">{item.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(item.id)}
                    className="ml-1 rounded-sm transition-colors hover:bg-muted-foreground/20"
                    aria-label={t('chat_input_removeFile', [item.name])}>
                    <span className="text-xs">✕</span>
                  </button>
                </Badge>
              ),
            )}
            {attachedFiles.map(file => (
              <Badge key={file.id} variant="secondary" className="flex items-center gap-1 pr-1">
                <span className="text-xs">📎</span>
                <span className="max-w-[150px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.id)}
                  className="ml-1 rounded-sm transition-colors hover:bg-muted-foreground/20"
                  aria-label={t('chat_input_removeFile', [file.name])}>
                  <span className="text-xs">✕</span>
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="relative">
          {suggestions.isOpen ? (
            <ComposerPopup
              listboxId={listboxId}
              label={suggestions.kind === 'mention' ? t('chat_input_mentionsLabel') : t('chat_input_commandsLabel')}
              emptyText={suggestions.kind === 'mention' ? t('chat_input_mentionEmpty') : t('chat_input_commandEmpty')}
              items={suggestions.items}
              activeIndex={suggestions.activeIndex}
              renderIcon={item => {
                const favicon = suggestions.kind === 'mention' ? mentionFavicons.get(item.id) : undefined;
                return favicon ? (
                  <img src={favicon} alt="" referrerPolicy="no-referrer" className="size-4 shrink-0" />
                ) : null;
              }}
              onSelect={index => suggestions.select(index)}
              onHover={index => suggestions.setActiveIndex(index)}
            />
          ) : null}
          <Textarea
            ref={textareaRef}
            role="combobox"
            aria-expanded={suggestions.isOpen}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={suggestions.isOpen ? listboxId : undefined}
            aria-activedescendant={activeOptionId}
            value={text}
            onChange={handleTextChange}
            onSelect={e => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            aria-disabled={disabled}
            rows={3}
            className="assistant-editor w-full resize-none border-none bg-card shadow-none focus-visible:ring-0"
            placeholder={
              hasAttachments
                ? t('chat_input_placeholder_withAttachments')
                : (placeholder ?? t('chat_input_placeholder'))
            }
            aria-label={t('chat_input_editor')}
          />
        </div>

        <div className="flex items-center justify-between bg-card px-2 py-1.5">
          <div className="flex shrink-0 gap-0.5 text-muted-foreground">
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

            {/* Hidden file input: text files are inlined, images are resized, other files are uploaded on request */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />

            {onSchedule && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onSchedule(text.trim())}
                disabled={disabled}
                aria-label={t('chat_schedule_btn_a11y')}
                title={t('chat_schedule_btn_a11y')}
                className="size-8">
                <FiClock size={17} />
              </Button>
            )}

            {onCaptureScreenshot && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCapture}
                disabled={disabled || isCapturing}
                aria-label={t('chat_input_captureScreenshot')}
                title={t('chat_input_captureScreenshot')}
                className="size-8">
                {isCapturing ? <AiOutlineLoading3Quarters className="size-4 animate-spin" /> : <FiCamera size={17} />}
              </Button>
            )}

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

          <div className="flex min-w-0 items-center gap-2">
            {footer}
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
      </div>
      {isDragging ? <p className="px-3 pb-1 text-xs text-primary">{t('chat_input_dropHint')}</p> : null}
      {fileError ? (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {fileError}
        </p>
      ) : null}
      {cropSource ? (
        <ScreenshotCropper src={cropSource} onConfirm={handleCropConfirm} onCancel={() => setCropSource(null)} />
      ) : null}
    </form>
  );
}

export default memo(ChatInput);
