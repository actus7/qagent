import type { KeyboardEvent } from 'react';
import { TAG_CHIP_CLASS, TAG_CONTAINER_CLASS, TAG_INPUT_CLASS } from './constants';

interface TagListInputProps {
  id: string;
  tags: string[];
  inputValue: string;
  placeholder: string;
  /** Shown instead of the chips when the list is empty. */
  emptyText?: string;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemove: (tag: string) => void;
}

/** Chip list with a trailing text input, used for model names and Azure deployments. */
export function TagListInput({
  id,
  tags,
  inputValue,
  placeholder,
  emptyText,
  onInputChange,
  onInputKeyDown,
  onRemove,
}: TagListInputProps) {
  return (
    <div className={TAG_CONTAINER_CLASS}>
      {tags.length === 0 && emptyText ? (
        <span className="text-xs text-muted-foreground">{emptyText}</span>
      ) : (
        tags.map(tag => (
          <div key={tag} className={TAG_CHIP_CLASS}>
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => onRemove(tag)}
              className="ml-1 font-bold text-primary hover:text-primary"
              aria-label={`Remove ${tag}`}>
              ×
            </button>
          </div>
        ))
      )}
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={inputValue}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        className={TAG_INPUT_CLASS}
      />
    </div>
  );
}
