import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

type SupportedLocale = 'en' | 'pt_BR' | 'zh_TW';
type QuickStartTemplateId = 'login_smoke' | 'cart_checkout' | 'broken_links';

const supportedLocales: SupportedLocale[] = ['en', 'pt_BR', 'zh_TW'];
const quickStartTemplateOrder: QuickStartTemplateId[] = ['login_smoke', 'cart_checkout', 'broken_links'];

const quickStartTemplates: Record<SupportedLocale, Record<QuickStartTemplateId, { title: string; content: string }>> = {
  en: {
    login_smoke: {
      title: '🔐 Login Test (Smoke Test)',
      content:
        '- Go to https://the-internet.herokuapp.com/login\n- Try logging in with username "tomsmith" and password "SuperSecretPassword!"\n- Verify login succeeds and the message "You logged into a secure area!" appears.\n- Log out and verify you return to the login screen.',
    },
    cart_checkout: {
      title: '🛒 Shopping Cart Test',
      content:
        'Go to https://www.saucedemo.com/\n- Log in with "standard_user" and "secret_sauce"\n- Add the first item to the cart\n- Open the cart and verify the item is there\n- Proceed to checkout and verify the address fields are required.',
    },
    broken_links: {
      title: '🔗 Broken Links Check',
      content:
        'Go to https://the-internet.herokuapp.com/\n- Verify the first 5 links in the list are working (not returning 404)\n- Report any broken links found.',
    },
  },
  pt_BR: {
    login_smoke: {
      title: '🔐 Teste de Login (Smoke Test)',
      content:
        '- Vá para https://the-internet.herokuapp.com/login\n- Tente logar com usuário "tomsmith" e senha "SuperSecretPassword!"\n- Verifique se o login foi bem-sucedido e se a mensagem "You logged into a secure area!" aparece.\n- Faça logout e verifique se retornou à tela de login.',
    },
    cart_checkout: {
      title: '🛒 Teste de Carrinho de Compras',
      content:
        'Vá para https://www.saucedemo.com/\n- Logue com "standard_user" e "secret_sauce"\n- Adicione o primeiro item ao carrinho\n- Vá para o carrinho e verifique se o item está lá\n- Prossiga para o checkout e verifique se os campos de endereço são obrigatórios.',
    },
    broken_links: {
      title: '🔗 Verificação de Links Quebrados',
      content:
        'Vá para https://the-internet.herokuapp.com/\n- Verifique se os 5 primeiros links da lista estão funcionando (não retornam 404)\n- Relate quaisquer links quebrados encontrados.',
    },
  },
  zh_TW: {
    login_smoke: {
      title: '🔐 登入測試（Smoke Test）',
      content:
        '- 前往 https://the-internet.herokuapp.com/login\n- 使用使用者「tomsmith」與密碼「SuperSecretPassword!」嘗試登入\n- 確認登入成功，且出現訊息「You logged into a secure area!」\n- 登出並確認回到登入頁面。',
    },
    cart_checkout: {
      title: '🛒 購物車測試',
      content:
        '前往 https://www.saucedemo.com/\n- 使用「standard_user」與「secret_sauce」登入\n- 將第一個商品加入購物車\n- 開啟購物車並確認商品存在\n- 進入結帳並確認地址欄位為必填。',
    },
    broken_links: {
      title: '🔗 壞連結檢查',
      content:
        '前往 https://the-internet.herokuapp.com/\n- 確認清單前 5 個連結可正常開啟（不回傳 404）\n- 回報找到的壞連結。',
    },
  },
};

function resolveLocale(language: string | undefined | null): SupportedLocale {
  if (typeof language === 'string' && language !== 'auto') {
    const normalizedLanguage = language.replace('-', '_');
    if (supportedLocales.includes(normalizedLanguage as SupportedLocale)) {
      return normalizedLanguage as SupportedLocale;
    }
  }

  const browserLocale = Intl.DateTimeFormat().resolvedOptions().locale.replace('-', '_');
  if (supportedLocales.includes(browserLocale as SupportedLocale)) {
    return browserLocale as SupportedLocale;
  }

  const browserLang = browserLocale.split('_')[0];
  if (browserLang === 'pt') {
    return 'pt_BR';
  }
  if (browserLang === 'zh') {
    return 'zh_TW';
  }
  return 'en';
}

function sortByIdDesc(prompts: FavoritePrompt[]): FavoritePrompt[] {
  return [...prompts].sort((a, b) => b.id - a.id);
}

function createDefaultFavoritePrompts(locale: SupportedLocale): FavoritePrompt[] {
  return quickStartTemplateOrder.map((templateId, index) => ({
    id: index + 1,
    templateId,
    title: quickStartTemplates[locale][templateId].title,
    content: quickStartTemplates[locale][templateId].content,
  }));
}

function inferTemplateId(prompt: FavoritePrompt): QuickStartTemplateId | undefined {
  for (const templateId of quickStartTemplateOrder) {
    const matchesAnyContent = supportedLocales.some(locale => quickStartTemplates[locale][templateId].content === prompt.content);
    if (!matchesAnyContent) {
      continue;
    }

    // Respect user custom titles for legacy prompts that don't carry template metadata.
    const matchesAnyTemplateTitle = supportedLocales.some(
      locale => quickStartTemplates[locale][templateId].title === prompt.title,
    );
    if (prompt.templateId || matchesAnyTemplateTitle) {
      return templateId;
    }
  }
  return undefined;
}

function localizePrompt(prompt: FavoritePrompt, locale: SupportedLocale): FavoritePrompt {
  const templateId = prompt.templateId ?? inferTemplateId(prompt);
  if (!templateId) {
    return prompt;
  }

  const template = quickStartTemplates[locale][templateId];
  return {
    ...prompt,
    templateId,
    title: template.title,
    content: template.content,
  };
}

async function ensureQuickStartLocalized(locale: SupportedLocale): Promise<FavoritePrompt[]> {
  const state = await favoritesStorage.get();

  if (state.prompts.length === 0 && state.nextId === 1) {
    const defaultPrompts = createDefaultFavoritePrompts(locale);
    await favoritesStorage.set({
      nextId: defaultPrompts.length + 1,
      prompts: defaultPrompts,
    });
    const initialized = await favoritesStorage.get();
    return sortByIdDesc(initialized.prompts);
  }

  let hasChanges = false;
  const localizedPrompts = state.prompts.map(prompt => {
    const localized = localizePrompt(prompt, locale);
    if (
      localized.templateId !== prompt.templateId ||
      localized.title !== prompt.title ||
      localized.content !== prompt.content
    ) {
      hasChanges = true;
    }
    return localized;
  });

  if (hasChanges) {
    await favoritesStorage.set(prev => ({
      ...prev,
      prompts: localizedPrompts,
    }));
    const updated = await favoritesStorage.get();
    return sortByIdDesc(updated.prompts);
  }

  return sortByIdDesc(state.prompts);
}

// Define the favorite prompt type
export interface FavoritePrompt {
  id: number;
  title: string;
  content: string;
  templateId?: QuickStartTemplateId;
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
  getAllPrompts: (preferredLocale?: string) => Promise<FavoritePrompt[]>;
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
            // Once a user edits a default template, keep it custom and don't auto-localize it.
            updatedPrompt = { ...prompt, title, content, templateId: undefined };
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
            // Once a user edits a default template, keep it custom and don't auto-localize it.
            updatedPrompt = { ...prompt, title, templateId: undefined };
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

    getAllPrompts: async (preferredLocale?: string): Promise<FavoritePrompt[]> => {
      return ensureQuickStartLocalized(resolveLocale(preferredLocale ?? null));
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
