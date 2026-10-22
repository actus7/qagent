import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
const storage = vi.hoisted(() => ({
  getFirewall: vi.fn(),
  getSession: vi.fn(),
  addMessage: vi.fn(),
}));
vi.mock('@extension/storage', () => ({
  Actors: { USER: 'user', ASSISTANT: 'assistant' },
  firewallStore: { getFirewall: storage.getFirewall },
  chatHistoryStore: { getSession: storage.getSession, addMessage: storage.addMessage },
}));
import { readSelectedTabs, streamBrowserAnswer } from '../browser-assistant';

describe('read-only browser assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getFirewall.mockResolvedValue({ enabled: false });
    storage.getSession.mockResolvedValue({ messages: [] });
    storage.addMessage.mockResolvedValue({});
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(async (id: number) => ({ id, url: 'https://example.com/article' })) },
      scripting: {
        executeScript: vi.fn(async () => [
          { result: { title: 'Article', text: 'Page content', url: 'https://example.com/article' } },
        ]),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads only explicitly selected tabs, without attaching a debugger', async () => {
    const context = await readSelectedTabs([4, 4, 9]);
    expect(chrome.tabs.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chrome.scripting.executeScript).mock.calls.map(call => call[0].target.tabId)).toEqual([4, 9]);
    expect(context).toContain('nano_untrusted_content');
    expect(context).toContain('Page content');
  });

  it('honors the firewall before reading the page', async () => {
    storage.getFirewall.mockResolvedValue({ enabled: true, allowList: [], denyList: ['example.com'] });
    await expect(readSelectedTabs([4])).rejects.toThrow('firewall');
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('streams text and persists one finished answer with conversation context', async () => {
    storage.getSession.mockResolvedValue({
      messages: [
        { actor: 'user', content: 'Previous question' },
        { actor: 'assistant', content: 'Previous answer' },
        { actor: 'user', content: 'Summarize' },
      ],
    });
    const stream = vi.fn(async function* () {
      yield { content: 'Hello ' };
      yield { content: [{ type: 'text', text: '**world**' }] };
    });
    const post = vi.fn();
    await streamBrowserAnswer({
      taskId: 'session',
      task: 'Summarize',
      mode: 'chat',
      tabIds: [4],
      model: { stream } as unknown as BaseChatModel,
      signal: new AbortController().signal,
      post,
    });
    expect(storage.addMessage).toHaveBeenCalledTimes(1);
    expect(storage.addMessage).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ actor: 'assistant', content: 'Hello **world**' }),
    );
    const prompt = stream.mock.calls[0] as unknown as [Array<{ content: string }>];
    expect(prompt[0].map(message => message.content).filter(content => content === 'Summarize')).toHaveLength(1);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'assistant_delta', finished: true, content: 'Hello **world**' }),
    );
  });

  it('does not save an incomplete answer when interrupted', async () => {
    const controller = new AbortController();
    const stream = vi.fn(async function* () {
      yield { content: 'Partial' };
      controller.abort();
      yield { content: ' discarded' };
    });
    await streamBrowserAnswer({
      taskId: 'session',
      task: 'Plan',
      mode: 'plan',
      tabIds: [],
      model: { stream } as unknown as BaseChatModel,
      signal: controller.signal,
      post: vi.fn(),
    });
    expect(storage.addMessage).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
