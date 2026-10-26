import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProviderModels } from '@extension/shared';
import type { ProviderConfig } from '@extension/storage';

export type CatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; models: string[] }
  | { status: 'error'; error: unknown };

/**
 * Model list the provider returns for the given config. Fetches once on mount when a key or
 * base URL is present; later fetches only happen when `load` is called (for example by the picker).
 */
export function useProviderModelCatalog(config: ProviderConfig) {
  const [state, setState] = useState<CatalogState>({ status: 'idle' });
  const latestRequestRef = useRef(0);
  const hasAutoLoadedRef = useRef(false);
  const { type, apiKey, baseUrl } = config;
  const canFetch = Boolean(apiKey?.trim() || baseUrl?.trim());

  const load = useCallback(async () => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setState({ status: 'loading' });
    try {
      const models = await fetchProviderModels({ type: type ?? '', apiKey, baseUrl });
      if (requestId === latestRequestRef.current) {
        setState({ status: 'ready', models });
      }
    } catch (error) {
      if (requestId === latestRequestRef.current) {
        setState({ status: 'error', error });
      }
    }
  }, [type, apiKey, baseUrl]);

  // Auto-load only on the first run (mount). Later key or URL edits do not trigger requests.
  useEffect(() => {
    if (hasAutoLoadedRef.current) {
      return;
    }
    hasAutoLoadedRef.current = true;
    if (canFetch) {
      void load();
    }
  }, [canFetch, load]);

  return { state, load };
}
