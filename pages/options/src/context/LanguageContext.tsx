import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { generalSettingsStore } from '@extension/storage';
import { defaultLocale, resolveLocale, t } from '@extension/i18n';

export type Language = 'auto' | 'en' | 'pt_BR' | 'zh_TW';

interface LanguageContextType {
  language: Language;
  changeLanguage: (lang: Language) => Promise<void>;
  currentLocale: 'en' | 'pt_BR' | 'zh_TW';
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);
const supportedLanguages = new Set<Language>(['auto', 'en', 'pt_BR', 'zh_TW']);

function normalizeLanguage(language: unknown): Language {
  if (typeof language === 'string' && supportedLanguages.has(language as Language)) {
    return language as Language;
  }
  return 'auto';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('auto');
  const [currentLocale, setCurrentLocale] = useState<'en' | 'pt_BR' | 'zh_TW'>(defaultLocale);
  const [isLoaded, setIsLoaded] = useState(false);

  const applyLanguage = useCallback((nextLanguage: Language) => {
    const locale = resolveLocale(nextLanguage);
    t.devLocale = locale;
    setLanguage(nextLanguage);
    setCurrentLocale(locale);
  }, []);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const settings = await generalSettingsStore.getSettings();
        if (!active) {
          return;
        }
        applyLanguage(normalizeLanguage(settings.language));
      } catch (error) {
        console.error('Failed to load language settings:', error);
      } finally {
        if (active) {
          setIsLoaded(true);
        }
      }
    };

    const unsubscribe = generalSettingsStore.subscribe(() => {
      if (!active) {
        return;
      }
      const snapshot = generalSettingsStore.getSnapshot();
      if (!snapshot) {
        return;
      }
      applyLanguage(normalizeLanguage(snapshot.language));
    });

    void loadSettings();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyLanguage]);

  const changeLanguage = useCallback(
    async (newLanguage: Language) => {
      const normalizedLanguage = normalizeLanguage(newLanguage);
      applyLanguage(normalizedLanguage);

      try {
        await generalSettingsStore.updateSettings({ language: normalizedLanguage });
      } catch (error) {
        console.error('Failed to update language settings:', error);
      }
    },
    [applyLanguage],
  );

  if (!isLoaded) {
    return null;
  }

  return <LanguageContext.Provider value={{ language, changeLanguage, currentLocale }}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
