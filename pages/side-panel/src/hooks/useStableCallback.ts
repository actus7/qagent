import { useCallback, useRef } from 'react';

/**
 * Returns an identity-stable function that always calls the latest `fn`. Memoized children can take it as a prop
 * without re-rendering whenever the parent recreates its handler.
 */
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args: Args) => fnRef.current(...args), []);
}
