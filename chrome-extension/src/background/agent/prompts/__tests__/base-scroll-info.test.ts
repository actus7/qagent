import { describe, expect, it, vi } from 'vitest';
import type { SystemModelMessage } from 'ai';
import type { AgentContext } from '../../types';
import { BasePrompt } from '../base';

vi.mock('../../../plugins/context', () => ({ loadPluginPromptSection: async () => '' }));
vi.mock('../../../mcp/context', () => ({ loadMcpPromptSection: async () => '' }));

class TestPrompt extends BasePrompt {
  getSystemMessage(): SystemModelMessage {
    return { role: 'system', content: '' };
  }

  async getUserMessage(context: AgentContext) {
    return this.buildBrowserStateUserMessage(context);
  }
}

function contextForPage(scrollHeight: number, visualViewportHeight: number): AgentContext {
  const browserState = {
    url: 'https://example.com',
    title: 'Example',
    tabId: 1,
    tabs: [],
    screenshot: null,
    stale: false,
    scrollY: 0,
    scrollHeight,
    visualViewportHeight,
    elementTree: { clickableElementsToString: () => '[1]<button>Go</button>' },
  };
  return {
    options: { useVision: false, includeAttributes: [] },
    browserContext: { getState: async () => browserState },
    stepInfo: null,
    actionResults: [],
    todos: [],
  } as unknown as AgentContext;
}

describe('BasePrompt scroll info', () => {
  it('reports the viewport share of the scrollable distance for a long page', async () => {
    const message = await new TestPrompt().getUserMessage(contextForPage(2000, 1000));

    expect(message.content).toContain('visual viewport height as percentage of scrollable distance: 100%');
  });

  it('does not print Infinity when the page is shorter than the viewport', async () => {
    const message = await new TestPrompt().getUserMessage(contextForPage(800, 800));

    expect(String(message.content)).not.toContain('Infinity');
    expect(String(message.content)).toContain('percentage of scrollable distance: 100%');
  });
});
