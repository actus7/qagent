import { useState } from 'react';
import type { assistantCopy } from '../lib/assistant-copy';
import type { QuestionState } from '../hooks/useTaskRunState';

interface QuestionBannerProps {
  copy: ReturnType<typeof assistantCopy>;
  question: QuestionState;
  onAnswer: (answer: string) => void;
}

/** Shown while an ask_user action waits: the question, its clickable options and a free answer. */
export default function QuestionBanner({ copy, question, onAnswer }: QuestionBannerProps) {
  const [draft, setDraft] = useState('');
  const submit = (answer: string) => {
    const text = answer.trim();
    if (text) onAnswer(text);
  };

  return (
    <div role="alert" className="mx-3 mb-2 space-y-2 rounded-lg border border-primary/60 bg-primary/10 p-3">
      <strong className="block text-sm wrap-break-word">{question.question}</strong>
      {question.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {question.options.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => submit(option)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted">
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault();
          submit(draft);
        }}>
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={copy.questionPlaceholder}
          aria-label={copy.questionPlaceholder}
          className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground"
        />
        <button
          type="submit"
          disabled={draft.trim() === ''}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {copy.questionSend}
        </button>
      </form>
    </div>
  );
}
