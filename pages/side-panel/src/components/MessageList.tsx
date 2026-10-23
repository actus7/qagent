import { memo, useState, lazy, Suspense } from 'react';
import { FiCheck, FiCopy, FiChevronRight, FiAlertCircle } from 'react-icons/fi';
import { Actors, type Message } from '@extension/storage';
import { t } from '@extension/i18n';
import { useLanguage } from '@extension/shared';
import { assistantCopy } from '../lib/assistant-copy';

const Markdown = lazy(() => import('./ResponseMarkdown'));

export default memo(function MessageList({ messages }: { messages: Message[] }) {
  const groups: Message[][] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    if (message.kind === 'activity' && previous?.[0].kind === 'activity') previous.push(message);
    else groups.push([message]);
  }
  // The log is append-only, so a position is a stable identity here.
  /* eslint-disable @eslint-react/no-array-index-key */
  return (
    <div className="assistant-messages">
      {groups.map((group, index) =>
        group[0].kind === 'activity' ? (
          <ActivityGroup key={`activity-${index}`} messages={group} />
        ) : (
          <MessageBlock key={group[0].streamId ?? `${group[0].timestamp}-${index}`} message={group[0]} />
        ),
      )}
    </div>
  );
  /* eslint-enable @eslint-react/no-array-index-key */
});

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
}

const MessageBlock = memo(function MessageBlock({ message }: { message: Message }) {
  const { currentLocale } = useLanguage();
  const copy = assistantCopy(currentLocale);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const isUser = message.actor === Actors.USER;
  const isNotice = message.actor === Actors.SYSTEM;
  if (message.content === t('sidepanel_progress_message')) return null;
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
