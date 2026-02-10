/* eslint-disable react/prop-types */
import { FaTrash } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';
import { Card } from '@src/components/ui/card';
import { ScrollArea } from '@src/components/ui/scroll-area';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
}) => {
  if (!visible) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <ScrollArea className="h-full p-4">
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        {t('chat_history_title')}
      </h2>
      {sessions.length === 0 ? (
        <Card className="p-4 text-center text-muted-foreground">
          {t('chat_history_empty')}
        </Card>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <Card
              key={session.id}
              className="group relative cursor-pointer p-3 transition-colors hover:bg-accent">
              <button onClick={() => onSessionSelect(session.id)} className="w-full text-left" type="button">
                <h3 className="text-sm font-medium text-foreground">
                  {session.title}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(session.createdAt)}
                </p>
              </button>

              {/* Bookmark button - top right */}
              {onSessionBookmark && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={e => {
                    e.stopPropagation();
                    onSessionBookmark(session.id);
                  }}
                  className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={t('chat_history_bookmark')}
                  type="button">
                  <BsBookmark size={14} />
                </Button>
              )}

              {/* Delete button - bottom right */}
              <Button
                variant="ghost"
                size="icon"
                onClick={e => {
                  e.stopPropagation();
                  onSessionDelete(session.id);
                }}
                className="absolute bottom-2 right-2 size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                aria-label={t('chat_history_delete')}
                type="button">
                <FaTrash size={14} />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </ScrollArea>
  );
};

export default ChatHistoryList;
