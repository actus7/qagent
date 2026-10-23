// Pure helpers for the composer popups: "@" tab mentions and "/" slash commands.

export const MENTION_MAX_RESULTS = 50;

export interface ActiveTrigger {
  /** Index of the trigger character in the text. */
  start: number;
  /** Text typed after the trigger, up to the caret. */
  query: string;
}

/**
 * Finds the trigger token that ends at the caret.
 * "@" triggers anywhere a token starts (start of text or after whitespace).
 * "/" triggers only as the first token of the composer, so paths and prose are never intercepted.
 */
export function findActiveTrigger(text: string, caret: number, trigger: '@' | '/'): ActiveTrigger | null {
  const beforeCaret = text.slice(0, caret);
  const match = /(^|\s)([@/])(\S*)$/.exec(beforeCaret);
  if (!match || match[2] !== trigger) return null;
  const start = beforeCaret.length - match[3].length - 1;
  if (trigger === '/' && start !== 0) return null;
  return { start, query: match[3] };
}

/** Replaces the trigger token (from its start up to the caret) with the given text. */
export function replaceTrigger(
  text: string,
  caret: number,
  trigger: ActiveTrigger,
  replacement: string,
): { text: string; caret: number } {
  const next = text.slice(0, trigger.start) + replacement + text.slice(caret);
  return { text: next, caret: trigger.start + replacement.length };
}

export interface MentionableTab {
  id: number;
  title: string;
  url: string;
}

const isMentionable = (tab: MentionableTab): boolean => {
  try {
    const url = new URL(tab.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Filters open tabs for the "@" popup by title or host; keeps only http(s) tabs and caps the list. */
export function filterMentionTabs<T extends MentionableTab>(
  tabs: readonly T[],
  query: string,
  limit = MENTION_MAX_RESULTS,
): T[] {
  const needle = query.trim().toLowerCase();
  return tabs
    .filter(isMentionable)
    .filter(tab => {
      if (!needle) return true;
      return tab.title.toLowerCase().includes(needle) || new URL(tab.url).hostname.toLowerCase().includes(needle);
    })
    .slice(0, limit);
}

/** Host used as the visible token for a mentioned tab. */
export const mentionTokenFor = (tab: MentionableTab): string => new URL(tab.url).hostname;

export interface SlashCommandItem {
  /** Name typed after "/", lowercase, without spaces. */
  slug: string;
  title: string;
  description?: string;
  /** Built-in commands run an action; saved prompts insert their content. */
  kind: 'builtin' | 'prompt';
  content?: string;
}

/** Turns a saved prompt title into a slash slug such as "login-smoke-test". */
export function slugifyCommand(title: string, fallback: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

/** Filters slash items by prefix first, then by substring. */
export function filterSlashItems(items: readonly SlashCommandItem[], query: string): SlashCommandItem[] {
  const needle = query.trim().toLowerCase();
  const matches = items.filter(item => item.slug.includes(needle) || item.title.toLowerCase().includes(needle));
  const rank = (item: SlashCommandItem) => (item.slug.startsWith(needle) ? 0 : 1);
  return [...matches].sort((a, b) => rank(a) - rank(b) || a.slug.length - b.slug.length);
}

/** Parses a composer line such as "/replay abc" into its command name and argument text. */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}
