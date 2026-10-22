import AgentBrowserContext from '../browser/agent-browser/context';
import ScopedBrowserContext from '../browser/scoped-context';
import { AgentBrowserCompanionClient } from '../browser/agent-browser/client';
import type { BrowserContextLike } from '../browser/types';

// Single browser session for the service worker. Only this module constructs these instances.
// Native tabs are the default. The isolated companion remains available as an explicit opt-in.
export const browserEngine =
  import.meta.env.VITE_BROWSER_ENGINE === 'agent-browser' ? 'agent-browser' : 'chrome-debugger';

export const agentBrowserCompanionClient = new AgentBrowserCompanionClient({
  url: import.meta.env.VITE_AGENT_BROWSER_WS_URL || 'ws://127.0.0.1:9223',
  token: import.meta.env.VITE_AGENT_BROWSER_WS_TOKEN || undefined,
});

export const browserContext: BrowserContextLike =
  browserEngine === 'agent-browser'
    ? new AgentBrowserContext({}, agentBrowserCompanionClient)
    : new ScopedBrowserContext({});

export function isAgentBrowserContext(context: BrowserContextLike): context is AgentBrowserContext {
  return context.getEngineName() === 'agent-browser-v1';
}
