import { useState, type KeyboardEvent } from 'react';
import {
  filterMentionTabs,
  filterSlashItems,
  findActiveTrigger,
  mentionTokenFor,
  replaceTrigger,
  type ActiveTrigger,
  type SlashCommandItem,
} from '@extension/shared';

export interface SuggestionItem {
  id: string;
  label: string;
  description?: string;
}

export interface MentionSource {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

interface UseComposerSuggestionsArgs {
  text: string;
  caret: number;
  mentionTabs: MentionSource[];
  commands: SlashCommandItem[];
  /** Replaces the composer text and caret position. */
  apply: (next: { text: string; caret: number }) => void;
  onMention: (tabId: number) => void;
  onCommand: (item: SlashCommandItem) => void;
}

type ActiveSuggestion =
  | { kind: 'mention'; trigger: ActiveTrigger; items: SuggestionItem[]; tabs: MentionSource[] }
  | { kind: 'command'; trigger: ActiveTrigger; items: SuggestionItem[]; commands: SlashCommandItem[] };

export const suggestionOptionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`;

/**
 * Drives the "@" tab mention popup and the "/" command popup. The popup belongs to the textarea:
 * the parent forwards keydown events to handleKeyDown and renders the returned items.
 */
export function useComposerSuggestions({
  text,
  caret,
  mentionTabs,
  commands,
  apply,
  onMention,
  onCommand,
}: UseComposerSuggestionsArgs) {
  const [highlight, setHighlight] = useState<{ key: string; index: number }>({ key: '', index: 0 });
  const [dismissedText, setDismissedText] = useState<string | null>(null);

  const suggestion = computeSuggestion(text, caret, mentionTabs, commands);
  const isOpen = suggestion !== null && dismissedText !== text;
  const key = suggestion ? `${suggestion.kind}|${suggestion.trigger.query}` : '';
  const activeIndex = highlight.key === key && suggestion ? Math.min(highlight.index, suggestion.items.length - 1) : 0;

  const move = (delta: number) => {
    const count = suggestion?.items.length ?? 0;
    if (count === 0) return;
    setHighlight({ key, index: (activeIndex + delta + count) % count });
  };

  const accept = (index: number) => {
    if (!suggestion) return;
    const item = suggestion.items[index];
    if (!item) return;
    if (suggestion.kind === 'mention') {
      const tab = suggestion.tabs.find(candidate => String(candidate.id) === item.id);
      if (!tab) return;
      const replacement = `@${mentionTokenFor(tab)} `;
      apply(replaceTrigger(text, caret, suggestion.trigger, replacement));
      onMention(tab.id);
      return;
    }
    const command = suggestion.commands.find(candidate => candidate.slug === item.id);
    if (!command) return;
    // Saved prompts insert their content; built-ins insert "/name " so arguments can follow (/new runs at once)
    const replacement =
      command.kind === 'prompt' ? (command.content ?? '') : command.slug === 'new' ? '' : `/${command.slug} `;
    apply(replaceTrigger(text, caret, suggestion.trigger, replacement));
    onCommand(command);
  };

  /** Returns true when the key was consumed by the popup. */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isOpen || !suggestion) return false;
    const hasItems = suggestion.items.length > 0;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissedText(text);
      return true;
    }
    if (!hasItems) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return true;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      accept(activeIndex);
      return true;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      accept(activeIndex);
      return true;
    }
    return false;
  };

  return {
    isOpen,
    kind: suggestion?.kind ?? null,
    items: isOpen && suggestion ? suggestion.items : [],
    activeIndex,
    select: accept,
    setActiveIndex: (index: number) => setHighlight({ key, index }),
    handleKeyDown,
  };
}

function computeSuggestion(
  text: string,
  caret: number,
  mentionTabs: MentionSource[],
  commands: SlashCommandItem[],
): ActiveSuggestion | null {
  const mention = findActiveTrigger(text, caret, '@');
  if (mention) {
    const tabs = filterMentionTabs(mentionTabs, mention.query);
    return {
      kind: 'mention',
      trigger: mention,
      tabs,
      items: tabs.map(tab => ({ id: String(tab.id), label: tab.title || tab.url, description: mentionTokenFor(tab) })),
    };
  }
  const command = findActiveTrigger(text, caret, '/');
  if (command) {
    const matches = filterSlashItems(commands, command.query);
    return {
      kind: 'command',
      trigger: command,
      commands: matches,
      items: matches.map(item => ({
        id: item.slug,
        label: `/${item.slug}`,
        description: item.description ?? item.title,
      })),
    };
  }
  return null;
}
