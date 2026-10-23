import { useEffect, useRef, type ReactNode } from 'react';
import { FiArrowUpRight, FiZap } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { Message } from '@extension/storage';
import { ScrollArea } from '@src/components/ui/scroll-area';
import type { assistantCopy } from '../lib/assistant-copy';
import MessageList from './MessageList';

interface ConversationAreaProps {
  copy: ReturnType<typeof assistantCopy>;
  isCheckingConfig: boolean;
  messages: Message[];
  welcome: ReactNode;
  /** Content of the latest plan answer when the "execute plan" action should be offered. */
  planAnswer: string | null;
  onExecutePlan: (planAnswer: string) => void;
  /** Resumes a task that the service worker restart interrupted. */
  onContinue: () => void;
}

export default function ConversationArea({
  copy,
  isCheckingConfig,
  messages,
  welcome,
  planAnswer,
  onExecutePlan,
  onContinue,
}: ConversationAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  let content: ReactNode;
  if (isCheckingConfig) {
    content = (
      <div className="assistant-loading" role="status">
        <span className="assistant-loading-dot" />
        {t('status_checkingConfig')}
      </div>
    );
  } else if (messages.length > 0) {
    content = <MessageList messages={messages} onContinue={onContinue} />;
  } else {
    content = welcome;
  }

  return (
    <ScrollArea className="assistant-conversation min-h-0 flex-1">
      {content}
      {planAnswer !== null ? (
        <button type="button" className="assistant-execute-plan" onClick={() => onExecutePlan(planAnswer)}>
          <FiZap size={14} />
          {copy.executePlan}
          <FiArrowUpRight size={14} />
        </button>
      ) : null}
      <div ref={messagesEndRef} />
    </ScrollArea>
  );
}
