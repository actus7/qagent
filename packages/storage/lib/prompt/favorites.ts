import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Template data
const defaultFavoritePrompts = [
  {
    title: '🔐 Teste de Login (Smoke Test)',
    content:
      '- Vá para https://the-internet.herokuapp.com/login\n- Tente logar com usuário "tomsmith" e senha "SuperSecretPassword!"\n- Verifique se o login foi bem-sucedido e se a mensagem "You logged into a secure area!" aparece.\n- Faça logout e verifique se retornou à tela de login.',
  },
  {
    title: '🛒 Teste de Carrinho de Compras',
    content: 'Vá para https://www.saucedemo.com/\n- Logue com "standard_user" e "secret_sauce"\n- Adicione o primeiro item ao carrinho\n- Vá para o carrinho e verifique se o item está lá\n- Prossiga para o checkout e verifique se os campos de endereço são obrigatórios.',
  },
  {
    title: '🔗 Verificação de Links Quebrados',
    content:
      "Vá para https://the-internet.herokuapp.com/\n- Verifique se os 5 primeiros links da lista estão funcionando (não retornam 404)\n- Relate quaisquer links quebrados encontrados.",
  },
];

// Define the favorite prompt type
export interface FavoritePrompt {
  id: number;
  title: string;
  content: string;
}

// Define the favorites storage type
export interface FavoritesStorage {
  nextId: number;
  prompts: FavoritePrompt[];
}

// Define the interface for favorite prompts storage operations
export interface FavoritePromptsStorage {
  addPrompt: (title: string, content: string) => Promise<FavoritePrompt>;
  updatePrompt: (id: number, title: string, content: string) => Promise<FavoritePrompt | undefined>;
  updatePromptTitle: (id: number, title: string) => Promise<FavoritePrompt | undefined>;
  removePrompt: (id: number) => Promise<void>;
  getAllPrompts: () => Promise<FavoritePrompt[]>;
  getPromptById: (id: number) => Promise<FavoritePrompt | undefined>;
  reorderPrompts: (draggedId: number, targetId: number) => Promise<void>;
}

// Initial state with proper typing
const initialState: FavoritesStorage = {
  nextId: 1,
  prompts: [],
};

// Create the favorites storage
const favoritesStorage: BaseStorage<FavoritesStorage> = createStorage('favorites', initialState, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/**
 * Creates a storage interface for managing favorite prompts
 */
export function createFavoritesStorage(): FavoritePromptsStorage {
  return {
    addPrompt: async (title: string, content: string): Promise<FavoritePrompt> => {
      // Check if prompt with same content already exists
      const { prompts } = await favoritesStorage.get();
      const existingPrompt = prompts.find(prompt => prompt.content === content);

      // If exists, return the existing prompt
      if (existingPrompt) {
        return existingPrompt;
      }

      // Otherwise add new prompt
      await favoritesStorage.set(prev => {
        const id = prev.nextId;
        const newPrompt: FavoritePrompt = { id, title, content };

        return {
          nextId: id + 1,
          prompts: [newPrompt, ...prev.prompts],
        };
      });

      return (await favoritesStorage.get()).prompts[0];
    },

    updatePrompt: async (id: number, title: string, content: string): Promise<FavoritePrompt | undefined> => {
      let updatedPrompt: FavoritePrompt | undefined;

      await favoritesStorage.set(prev => {
        const updatedPrompts = prev.prompts.map(prompt => {
          if (prompt.id === id) {
            updatedPrompt = { ...prompt, title, content };
            return updatedPrompt;
          }
          return prompt;
        });

        // If prompt wasn't found, leave the storage unchanged
        if (!updatedPrompt) {
          return prev;
        }

        return {
          ...prev,
          prompts: updatedPrompts,
        };
      });

      return updatedPrompt;
    },

    updatePromptTitle: async (id: number, title: string): Promise<FavoritePrompt | undefined> => {
      let updatedPrompt: FavoritePrompt | undefined;

      await favoritesStorage.set(prev => {
        const updatedPrompts = prev.prompts.map(prompt => {
          if (prompt.id === id) {
            updatedPrompt = { ...prompt, title };
            return updatedPrompt;
          }
          return prompt;
        });

        // If prompt wasn't found, leave the storage unchanged
        if (!updatedPrompt) {
          return prev;
        }

        return {
          ...prev,
          prompts: updatedPrompts,
        };
      });

      return updatedPrompt;
    },

    removePrompt: async (id: number): Promise<void> => {
      await favoritesStorage.set(prev => ({
        ...prev,
        prompts: prev.prompts.filter(prompt => prompt.id !== id),
      }));
    },

    getAllPrompts: async (): Promise<FavoritePrompt[]> => {
      const currentState = await favoritesStorage.get();
      let prompts = currentState.prompts;

      // Check if storage is in initial state (empty prompts array and nextId=1)
      if (currentState.prompts.length === 0 && currentState.nextId === 1) {
        // Initialize with default prompts
        for (const prompt of defaultFavoritePrompts) {
          await favoritesStorage.set(prev => {
            const id = prev.nextId;
            const newPrompt: FavoritePrompt = { id, title: prompt.title, content: prompt.content };
            return { nextId: id + 1, prompts: [newPrompt, ...prev.prompts] };
          });
        }
        const newState = await favoritesStorage.get();
        prompts = newState.prompts;
      }
      return [...prompts].sort((a, b) => b.id - a.id);
    },

    getPromptById: async (id: number): Promise<FavoritePrompt | undefined> => {
      const { prompts } = await favoritesStorage.get();
      return prompts.find(prompt => prompt.id === id);
    },

    reorderPrompts: async (draggedId: number, targetId: number): Promise<void> => {
      await favoritesStorage.set(prev => {
        // Create a copy of the current prompts
        const promptsCopy = [...prev.prompts];

        // Find indexes
        const sourceIndex = promptsCopy.findIndex(prompt => prompt.id === draggedId);
        const targetIndex = promptsCopy.findIndex(prompt => prompt.id === targetId);

        // Ensure both indexes are valid
        if (sourceIndex === -1 || targetIndex === -1) {
          return prev; // No changes if either index is invalid
        }

        // Reorder by removing dragged item and inserting at target position
        const [movedItem] = promptsCopy.splice(sourceIndex, 1);
        promptsCopy.splice(targetIndex, 0, movedItem);

        // Assign new IDs based on the order
        const numPrompts = promptsCopy.length;
        const updatedPromptsWithNewIds = promptsCopy.map((prompt, index) => ({
          ...prompt,
          id: numPrompts - index, // Assigns IDs: numPrompts, numPrompts-1, ..., 1
        }));

        return {
          ...prev,
          prompts: updatedPromptsWithNewIds,
          nextId: numPrompts + 1, // Update nextId accordingly
        };
      });
    },
  };
}

// Export an instance of the storage by default
export default createFavoritesStorage();
