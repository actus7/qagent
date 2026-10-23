// Chrome refuses chrome.debugger.attach when DevTools or another extension already controls the tab.
const DEBUGGER_CONFLICT_PATTERN = /another debugger is already attached|already attached to the tab/i;

export function isDebuggerConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return DEBUGGER_CONFLICT_PATTERN.test(message);
}
