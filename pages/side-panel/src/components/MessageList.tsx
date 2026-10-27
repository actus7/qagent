import { memo, useState, lazy, Suspense } from 'react';
import { FiCheck, FiCopy, FiChevronRight, FiAlertCircle, FiZap } from 'react-icons/fi';
import { Actors, type Message } from '@extension/storage';
import { t } from '@extension/i18n';
import { useLanguage } from '@extension/shared';
import { assistantCopy } from '../lib/assistant-copy';

const Markdown = lazy(() => import('./ResponseMarkdown'));

// Only the newest messages are mounted; older ones load on request so a long chat does not mount hundreds of Markdown trees.
const RENDER_WINDOW = 200;

// Row keys must survive the window sliding: a streamed answer keeps its streamId, every other message gets an
// identity assigned once per object (an index would shift for every row whenever the window moves).
const messageKeys = new WeakMap<Message, string>();
let nextMessageKey = 0;
function keyOf(message: Message): string {
  if (message.streamId) return message.streamId;
  let key = messageKeys.get(message);
  if (!key) {
    key = `message-${nextMessageKey++}`;
    messageKeys.set(message, key);
  }
  return key;
}

function groupMessages(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    if (message.kind === 'activity' && previous?.[0].kind === 'activity') previous.push(message);
    else groups.push([message]);
  }
  return groups;
}

export default memo(function MessageList({ messages, onContinue }: { messages: Message[]; onContinue?: () => void }) {
  const [windowSize, setWindowSize] = useState(RENDER_WINDOW);
  const hiddenCount = Math.max(0, messages.length - windowSize);
  const visible = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;
  const groups = groupMessages(visible);
  return (
    <div className="assistant-messages">
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="assistant-execute-plan mx-auto"
          onClick={() => setWindowSize(size => size + RENDER_WINDOW)}>
          {t('chat_showEarlier', [String(hiddenCount)])}
        </button>
      ) : null}
      {groups.map(group =>
        group[0].kind === 'activity' ? (
          <ActivityGroup key={keyOf(group[0])} messages={group} />
        ) : (
          <MessageBlock
            key={keyOf(group[0])}
            message={group[0]}
            onContinue={group[0] === messages.at(-1) ? onContinue : undefined}
          />
        ),
      )}
    </div>
  );
});

/** Rows are rebuilt on every delta; the group is compared by its members so unchanged logs skip re-rendering. */
const ActivityGroup = memo(
  function ActivityGroup({ messages }: { messages: Message[] }) {
    const { currentLocale } = useLanguage();
    const copy = assistantCopy(currentLocale);
    return (
      <details className="assistant-activity-log">
        <summary>
          <FiChevronRight />
          <span>{copy.activity}</span>
          <span>{messages.length}</span>
        </summary>
        <ol>
          {messages.map((message, index) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key -- append-only activity log
            <li key={index}>
              <FiCheck />
              <span>{message.content}</span>
            </li>
          ))}
        </ol>
      </details>
    );
  },
  (previous, next) =>
    previous.messages.length === next.messages.length &&
    previous.messages.every((message, index) => message === next.messages[index]),
);

const MessageBlock = memo(function MessageBlock({
  message,
  onContinue,
}: {
  message: Message;
  /** Set only on the latest message, where a restart notice can be resumed. */
  onContinue?: () => void;
}) {
  const { currentLocale } = useLanguage();
  const copy = assistantCopy(currentLocale);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const isUser = message.actor === Actors.USER;
  const isNotice = message.actor === Actors.SYSTEM;
  if (message.content === t('sidepanel_progress_message')) return null;
  if (message.kind === 'compaction') {
    // The summary is stored for the model; the UI keeps the full history and only marks where it was compacted.
    return (
      <div role="separator" className="my-3 flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-300" />
        <span>{t('chat_compacted_divider')}</span>
        <span className="h-px flex-1 bg-slate-300" />
      </div>
    );
  }
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setCopyError('');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <article
      className={`assistant-message ${isUser ? 'assistant-message-user' : isNotice ? 'assistant-message-notice' : 'assistant-message-answer'}`}>
      {isNotice ? <FiAlertCircle className="assistant-notice-icon" /> : null}
      {!isUser && !isNotice ? (
        <div className="assistant-answer-author">
          <span className="assistant-small-mark">Q</span>QAgent
        </div>
      ) : null}
      <div className="assistant-message-body">
        {isUser || isNotice ? (
          <div className="wrap-break-word whitespace-pre-wrap">{message.content}</div>
        ) : (
          <Suspense fallback={<div className="whitespace-pre-wrap">{message.content}</div>}>
            <Markdown content={message.content} />
          </Suspense>
        )}
        {message.kind === 'interrupted' && onContinue ? (
          <button type="button" className="assistant-execute-plan" onClick={onContinue}>
            <FiZap size={14} />
            {t('chat_continueTask')}
          </button>
        ) : null}
      </div>
      {!isUser && !isNotice ? (
        <div className="assistant-answer-actions">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? copy.copied : copy.copy}
            title={copied ? copy.copied : copy.copy}>
            {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
          </button>
          {copyError ? <span role="alert">{copyError}</span> : null}
        </div>
      ) : null}
    </article>
  );
});
