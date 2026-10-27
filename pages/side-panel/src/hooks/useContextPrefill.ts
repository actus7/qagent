import { useEffect, useRef } from 'react';
import { CONTEXT_PREFILL_STORAGE_KEY, type ContextPrefillPayload, readStoredContextPrefill } from '@extension/shared';

interface UseContextPrefillArgs {
  onPrefill: (payload: ContextPrefillPayload) => void;
}

/**
 * Applies a "Perguntar ao QAgent" prefill written by the background. It is consumed once: read on mount for a
 * prefill made while the panel was closed, and handled through storage.onChanged when the panel is already open.
 */
export function useContextPrefill({ onPrefill }: UseContextPrefillArgs): void {
  const onPrefillRef = useRef(onPrefill);

  useEffect(() => {
    onPrefillRef.current = onPrefill;
  }, [onPrefill]);

  useEffect(() => {
    let disposed = false;
    // createdAt identifies a stored prefill; the mount read and the change event can deliver the same one.
    let handledCreatedAt: number | null = null;

    const consume = async (value: unknown) => {
      const payload = readStoredContextPrefill(value, Date.now());
      if (!payload || disposed) return;
      const { createdAt } = value as { createdAt: number };
      if (createdAt === handledCreatedAt) return;
      handledCreatedAt = createdAt;
      await chrome.storage.session.remove(CONTEXT_PREFILL_STORAGE_KEY);
      if (!disposed) onPrefillRef.current(payload);
    };

    const readPending = async () => {
      const stored = await chrome.storage.session.get(CONTEXT_PREFILL_STORAGE_KEY);
      await consume(stored[CONTEXT_PREFILL_STORAGE_KEY]);
    };

    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      const change = changes[CONTEXT_PREFILL_STORAGE_KEY];
      if (area !== 'session' || !change?.newValue) return;
      void consume(change.newValue).catch(console.error);
    };

    void readPending().catch(console.error);
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, []);
}
