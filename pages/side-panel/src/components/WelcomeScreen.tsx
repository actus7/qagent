import { memo } from 'react';
import type { ComponentProps } from 'react';
import { FiArrowUpRight, FiChevronDown, FiCompass, FiFileText, FiLayers, FiZap } from 'react-icons/fi';
import { Button } from '@extension/ui';
import type { FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
import type { AssistantMode } from '@extension/shared';
import type { assistantCopy } from '../lib/assistant-copy';
import BookmarkList from './BookmarkList';

type BookmarkHandlers = Omit<ComponentProps<typeof BookmarkList>, 'bookmarks'>;

interface WelcomeScreenProps {
  copy: ReturnType<typeof assistantCopy>;
  hasConfiguredModels: boolean;
  favoritePrompts: FavoritePrompt[];
  bookmarkHandlers: BookmarkHandlers;
  onSuggestionSelect: (mode: AssistantMode, prompt: string) => void;
  onOpenOptions: () => void;
}

function WelcomeScreen({
  copy,
  hasConfiguredModels,
  favoritePrompts,
  bookmarkHandlers,
  onSuggestionSelect,
  onOpenOptions,
}: WelcomeScreenProps) {
  const suggestions = [
    { label: copy.summarize, prompt: copy.summarizePrompt, mode: 'chat' as const, icon: FiFileText },
    { label: copy.compare, prompt: copy.comparePrompt, mode: 'chat' as const, icon: FiLayers },
    { label: copy.research, prompt: copy.researchPrompt, mode: 'plan' as const, icon: FiCompass },
    { label: copy.automate, prompt: copy.automatePrompt, mode: 'act' as const, icon: FiZap },
  ];

  return (
    <div className="assistant-welcome">
      <div className="assistant-welcome-symbol" aria-hidden="true">
        <FiCompass size={36} strokeWidth={1.2} />
      </div>
      <p className="assistant-eyebrow">{copy.tagline}</p>
      <h1>{copy.greeting}</h1>
      <p className="assistant-welcome-intro">{copy.intro}</p>
      {hasConfiguredModels ? (
        <div className="assistant-suggestions">
          {suggestions.map(item => (
            <button key={item.label} type="button" onClick={() => onSuggestionSelect(item.mode, item.prompt)}>
              <item.icon size={17} />
              <span>{item.label}</span>
              <FiArrowUpRight size={14} />
            </button>
          ))}
        </div>
      ) : (
        <div className="assistant-setup">
          <strong>{copy.setupTitle}</strong>
          <p>{copy.setupBody}</p>
          <Button onClick={onOpenOptions}>
            {copy.setupAction}
            <FiArrowUpRight className="ml-2" />
          </Button>
        </div>
      )}
      {favoritePrompts.length > 0 ? (
        <details className="assistant-saved-prompts">
          <summary>
            {copy.saved}
            <FiChevronDown size={13} />
          </summary>
          <BookmarkList bookmarks={favoritePrompts} {...bookmarkHandlers} />
        </details>
      ) : null}
    </div>
  );
}

export default memo(WelcomeScreen);
