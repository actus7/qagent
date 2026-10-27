// Bridges the port reply for capture_visible_tab back to the composer that asked for it.
// Only one capture can be pending at a time; a new request replaces (and cancels) the previous one.

const CAPTURE_TIMEOUT_MS = 15000;

let pending: { resolve: (dataUrl: string) => void; reject: (error: Error) => void; timer: number } | null = null;

/** Sends the request via `send` and resolves with the PNG data URL, or rejects on error or timeout. */
export function requestTabCapture(send: () => void): Promise<string> {
  if (pending) {
    window.clearTimeout(pending.timer);
    pending.reject(new Error('capture superseded'));
  }
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (pending?.timer === timer) pending = null;
      reject(new Error('capture timed out'));
    }, CAPTURE_TIMEOUT_MS);
    pending = { resolve, reject, timer };
    try {
      send();
    } catch (error) {
      pending = null;
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function resolveTabCapture(dataUrl: string): void {
  if (!pending) return;
  const current = pending;
  pending = null;
  window.clearTimeout(current.timer);
  current.resolve(dataUrl);
}

export function rejectTabCapture(message: string): void {
  if (!pending) return;
  const current = pending;
  pending = null;
  window.clearTimeout(current.timer);
  current.reject(new Error(message));
}
