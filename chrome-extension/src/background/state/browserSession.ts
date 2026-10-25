import AgentBrowserContext from '../browser/agent-browser/context';
import ScopedBrowserContext from '../browser/scoped-context';
import ContentScriptBrowserContext from '../browser/content-script/context';
import { AgentBrowserCompanionClient } from '../browser/agent-browser/client';
import type { BrowserContextLike } from '../browser/types';
import { resolveBrowserEngine } from './engineSelection';

// Single browser session for the service worker. Only this module constructs these instances.
// Native tabs are the default. The isolated companion remains available as an explicit opt-in.
// Browsers without chrome.debugger (Firefox) run on the content-script engine.
export const browserEngine = resolveBrowserEngine({
  requested: import.meta.env.VITE_BROWSER_ENGINE,
  // typeof guard: modules are also imported where no extension runtime exists (unit tests).
  hasDebugger: typeof chrome !== 'undefined' && Boolean(chrome.debugger),
});

export const agentBrowserCompanionClient = new AgentBrowserCompanionClient({
  url: import.meta.env.VITE_AGENT_BROWSER_WS_URL || 'ws://127.0.0.1:9223',
  token: import.meta.env.VITE_AGENT_BROWSER_WS_TOKEN || undefined,
});

function createBrowserContext(): BrowserContextLike {
  if (browserEngine === 'agent-browser') {
    return new AgentBrowserContext({}, agentBrowserCompanionClient);
  }
  if (browserEngine === 'content-script') {
    return new ContentScriptBrowserContext({});
  }
  return new ScopedBrowserContext({});
}

export const browserContext: BrowserContextLike = createBrowserContext();

export function isAgentBrowserContext(context: BrowserContextLike): context is AgentBrowserContext {
  return context.getEngineName() === 'agent-browser-v1';
}
