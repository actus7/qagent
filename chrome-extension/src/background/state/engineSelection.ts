export type BrowserEngine = 'chrome-debugger' | 'agent-browser' | 'content-script';

export interface EngineSelectionInput {
  /** Value of VITE_BROWSER_ENGINE at build time. */
  requested: string | undefined;
  /** True when chrome.debugger exists (Chromium). Firefox has no debugger API. */
  hasDebugger: boolean;
}

/**
 * The explicit agent-browser opt-in always wins. Otherwise Chromium keeps chrome.debugger, and browsers without it
 * (Firefox) fall back to the content-script engine.
 */
export function resolveBrowserEngine(input: EngineSelectionInput): BrowserEngine {
  if (input.requested === 'agent-browser') return 'agent-browser';
  return input.hasDebugger ? 'chrome-debugger' : 'content-script';
}
