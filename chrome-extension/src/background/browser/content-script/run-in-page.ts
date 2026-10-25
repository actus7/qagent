/** Longest a tab may stay in "loading" before a step carries on with whatever is on screen. */
export const TAB_LOAD_TIMEOUT_MS = 10_000;

/**
 * Runs `func` in the top frame of a tab and returns its value. Only the top frame is reached; elements inside
 * iframes are reported as unsupported by the page methods.
 */
export async function runInPage<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args: Args,
  world: 'ISOLATED' | 'MAIN' = 'ISOLATED',
): Promise<Awaited<Result>> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
  if (!injection || injection.result === undefined) {
    throw new Error('The page returned no result (it may have navigated away)');
  }
  return injection.result as Awaited<Result>;
}

/**
 * Resolves once the tab reports "complete", or after `timeoutMs` (without failing) so a slow page never blocks a step
 * forever. Rejects only when the tab no longer exists.
 */
export function waitForTabComplete(tabId: number, timeoutMs: number = TAB_LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = (): void => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
    };
    const finish = (): void => {
      stop();
      resolve();
    };
    const onUpdated = (updatedId: number, info: chrome.tabs.OnUpdatedInfo): void => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(
      tab => {
        if (tab.status === 'complete') finish();
      },
      error => {
        stop();
        reject(error);
      },
    );
  });
}
