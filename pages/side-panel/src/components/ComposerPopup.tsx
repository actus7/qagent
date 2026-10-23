import type { ReactNode } from 'react';
import { suggestionOptionId, type SuggestionItem } from '@src/hooks/useComposerSuggestions';

interface ComposerPopupProps {
  listboxId: string;
  label: string;
  emptyText: string;
  items: SuggestionItem[];
  activeIndex: number;
  /** Optional leading icon per item, e.g. a tab favicon. */
  renderIcon?: (item: SuggestionItem) => ReactNode;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
}

/**
 * Listbox shown above the composer. Focus stays in the textarea; the active option is announced through
 * aria-activedescendant, so the popup never takes focus away from typing.
 */
export default function ComposerPopup({
  listboxId,
  label,
  emptyText,
  items,
  activeIndex,
  renderIcon,
  onSelect,
  onHover,
}: ComposerPopupProps) {
  return (
    <div className="absolute inset-x-2 bottom-full z-20 mb-1">
      <ul
        id={listboxId}
        role="listbox"
        aria-label={label}
        className="max-h-60 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg">
        {items.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-xs text-muted-foreground">
            {emptyText}
          </li>
        ) : (
          items.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <li
                key={item.id}
                id={suggestionOptionId(listboxId, index)}
                role="option"
                aria-selected={isActive}
                // mousedown keeps focus in the textarea; the click would otherwise blur it first
                onMouseDown={event => {
                  event.preventDefault();
                  onSelect(index);
                }}
                onMouseEnter={() => onHover(index)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                  isActive ? 'bg-muted text-foreground' : 'text-foreground/90'
                }`}>
                {renderIcon?.(item)}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.description ? (
                  <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
