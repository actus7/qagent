import { useEffect, useState } from 'react';
import { EMPTY_MANAGED_POLICY, hasManagedRestrictions, parseManagedPolicy, type ManagedPolicy } from '@extension/shared';

async function readManagedPolicy(): Promise<ManagedPolicy> {
  try {
    return parseManagedPolicy(await chrome.storage.managed.get(null));
  } catch {
    // Unmanaged browsers and unavailable storage mean no restrictions.
    return EMPTY_MANAGED_POLICY;
  }
}

/** Enterprise policy for the side panel UI. The background enforces it regardless of what the UI shows. */
export function useManagedPolicy(): { policy: ManagedPolicy; restricted: boolean } {
  const [policy, setPolicy] = useState<ManagedPolicy>(EMPTY_MANAGED_POLICY);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void readManagedPolicy().then(next => {
        if (active) setPolicy(next);
      });
    };
    refresh();
    const onChanged = (_changes: unknown, areaName: string) => {
      if (areaName === 'managed') refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return { policy, restricted: hasManagedRestrictions(policy) };
}
