/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes } from 'react-icons/fa';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';
import { Card } from '@src/components/ui/card';
import { Input } from '@src/components/ui/input';

interface Bookmark {
  id: number;
  title: string;
  content: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  onBookmarkUpdateTitle?: (id: number, title: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onBookmarkUpdateTitle,
  onBookmarkDelete,
  onBookmarkReorder,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdateTitle && editTitle.trim()) {
      onBookmarkUpdateTitle(id, editTitle);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  return (
    <div className="p-2">
      <h3 className="mb-3 text-sm font-medium text-foreground">
        {t('chat_bookmarks_header')}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {bookmarks.map(bookmark => (
          <Card
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className="group relative p-3 transition-colors hover:bg-accent">
            {editingId === bookmark.id ? (
              <div className="flex items-center">
                <Input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="mr-2 h-8 grow text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleSaveEdit(bookmark.id)}
                  className="size-7 text-primary"
                  aria-label={t('chat_bookmarks_saveEdit')}
                  type="button">
                  <FaCheck size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCancelEdit}
                  className="ml-1 size-7 text-destructive"
                  aria-label={t('chat_bookmarks_cancelEdit')}
                  type="button">
                  <FaTimes size={14} />
                </Button>
              </div>
            ) : (
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onBookmarkSelect(bookmark.content)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onBookmarkSelect(bookmark.content);
                    }
                  }}
                  className="w-full text-left">
                  <div className="truncate pr-10 text-sm font-medium text-foreground">
                    {bookmark.title}
                  </div>
                </button>
              </div>
            )}

            {editingId !== bookmark.id && (
              <>
                {/* Edit button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className="absolute right-[28px] top-1/2 z-10 size-7 -translate-y-1/2 text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  aria-label={t('chat_bookmarks_edit')}
                  type="button">
                  <FaPen size={14} />
                </Button>

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={e => {
                    e.stopPropagation();
                    if (onBookmarkDelete) {
                      onBookmarkDelete(bookmark.id);
                    }
                  }}
                  className="absolute right-2 top-1/2 z-10 size-7 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity duration-200 hover:text-destructive group-hover:opacity-100"
                  aria-label={t('chat_bookmarks_delete')}
                  type="button">
                  <FaTrash size={14} />
                </Button>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
