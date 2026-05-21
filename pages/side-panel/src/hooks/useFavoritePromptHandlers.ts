import { useCallback, useEffect } from 'react';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import type { FavoritePrompt } from '@extension/storage/lib/prompt/favorites';

interface UseFavoritePromptHandlersArgs {
  currentLocale: string;
  setFavoritePrompts: (value: FavoritePrompt[]) => void;
  setInputText: (text: string) => void;
}

export const useFavoritePromptHandlers = ({
  currentLocale,
  setFavoritePrompts,
  setInputText,
}: UseFavoritePromptHandlersArgs) => {
  const refreshFavoritePrompts = useCallback(async () => {
    try {
      const prompts = await favoritesStorage.getAllPrompts(currentLocale);
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to load favorite prompts:', error);
    }
  }, [currentLocale, setFavoritePrompts]);

  const handleBookmarkSelect = useCallback(
    (content: string) => {
      setInputText(content);
    },
    [setInputText],
  );

  const handleBookmarkUpdateTitle = useCallback(
    async (id: number, title: string) => {
      try {
        await favoritesStorage.updatePromptTitle(id, title);
        await refreshFavoritePrompts();
      } catch (error) {
        console.error('Failed to update favorite prompt title:', error);
      }
    },
    [refreshFavoritePrompts],
  );

  const handleBookmarkDelete = useCallback(
    async (id: number) => {
      try {
        await favoritesStorage.removePrompt(id);
        await refreshFavoritePrompts();
      } catch (error) {
        console.error('Failed to delete favorite prompt:', error);
      }
    },
    [refreshFavoritePrompts],
  );

  const handleBookmarkReorder = useCallback(
    async (draggedId: number, targetId: number) => {
      try {
        await favoritesStorage.reorderPrompts(draggedId, targetId);
        await refreshFavoritePrompts();
      } catch (error) {
        console.error('Failed to reorder favorite prompts:', error);
      }
    },
    [refreshFavoritePrompts],
  );

  useEffect(() => {
    void refreshFavoritePrompts();
  }, [refreshFavoritePrompts]);

  return {
    handleBookmarkSelect,
    handleBookmarkUpdateTitle,
    handleBookmarkDelete,
    handleBookmarkReorder,
    refreshFavoritePrompts,
  };
};
