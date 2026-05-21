import type { DevLocale, MessageKey } from './type';
import { defaultLocale, getMessageFromLocale } from './getMessageFromLocale';

type I18nValue = {
  message: string;
  placeholders?: Record<string, { content?: string; example?: string }>;
};

function translate(key: MessageKey, substitutions?: string | string[]) {
  const localizedValue = getMessageFromLocale(t.devLocale)[key] as I18nValue | undefined;
  const fallbackValue = getMessageFromLocale(defaultLocale)[key] as I18nValue | undefined;
  const value = localizedValue ?? fallbackValue;
  let message = value?.message ?? String(key);
  /**
   * This is a placeholder replacement logic. But it's not perfect.
   * It just imitates the behavior of the Chrome extension i18n API.
   * Please check the official document for more information And double-check the behavior on production build.
   *
   * @url https://developer.chrome.com/docs/extensions/how-to/ui/localization-message-formats#placeholders
   */
  if (value?.placeholders) {
    Object.entries(value.placeholders).forEach(([placeholderKey, { content }]) => {
      if (!content) {
        return;
      }
      message = message.replace(new RegExp(`\\$${placeholderKey}\\$`, 'gi'), content);
    });
  }
  if (!substitutions) {
    return message;
  }
  if (Array.isArray(substitutions)) {
    return substitutions.reduce((acc, cur, idx) => acc.replace(new RegExp(`\\$${idx + 1}`, 'g'), cur), message);
  }
  return message.replace(/\$1/g, substitutions);
}

function removePlaceholder(message: string) {
  return message.replace(/\$\d+/g, '');
}

export const t = (...args: Parameters<typeof translate>) => {
  return removePlaceholder(translate(...args));
};

t.devLocale = defaultLocale as DevLocale;
