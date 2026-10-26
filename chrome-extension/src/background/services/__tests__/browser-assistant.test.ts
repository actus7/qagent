import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { streamText } from 'ai';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';
const storage = vi.hoisted(() => ({
  getSession: vi.fn(),
  addMessage: vi.fn(),
}));
vi.mock('@extension/storage', () => ({
  Actors: { USER: 'user', ASSISTANT: 'assistant' },
  chatHistoryStore: { getSession: storage.getSession, addMessage: storage.addMessage },
}));
vi.mock('ai', () => ({ streamText: vi.fn() }));
import { readSelectedTabs, streamBrowserAnswer } from '../browser-assistant';

type Part = { type: 'text-delta'; id: string; text: string } | { type: 'error'; error: unknown };

/** Answers the next streamText call with the given parts, running `between` after each one. */
const streaming = (parts: Part[], between: () => void = () => {}) =>
  vi.mocked(streamText).mockImplementation(
    () =>
      ({
        stream: (async function* () {
          for (const part of parts) {
            yield part;
            between();
          }
        })(),
      }) as never,
  );

describe('read-only browser assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('streams text and persists one finished answer with conversation context', async () => {
    storage.getSession.mockResolvedValue({
      messages: [
        { actor: 'user', content: 'Previous question' },
        { actor: 'assistant', content: 'Previous answer' },
        { actor: 'user', content: 'Summarize' },
      ],
    });
    streaming([
      { type: 'text-delta', id: '1', text: 'Hello ' },
      { type: 'text-delta', id: '1', text: '**world**' },
    ]);
    const post = vi.fn();
    await streamBrowserAnswer({
      taskId: 'session',
      task: 'Summarize',
      mode: 'chat',
      tabIds: [4],
      model: fakeChatModel(),
      signal: new AbortController().signal,
      post,
    });
    expect(storage.addMessage).toHaveBeenCalledTimes(1);
    expect(storage.addMessage).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ actor: 'assistant', content: 'Hello **world**' }),
    );
    const options = vi.mocked(streamText).mock.calls[0][0] as {
      messages: Array<{ content: unknown }>;
      instructions: string;
    };
    expect(options.messages.map(message => message.content).filter(content => content === 'Summarize')).toHaveLength(1);
    expect(options.instructions).toContain('Page content');
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'assistant_delta', finished: true, content: 'Hello **world**' }),
    );
  });

  it('does not save an incomplete answer when interrupted', async () => {
    const controller = new AbortController();
    streaming(
      [
        { type: 'text-delta', id: '1', text: 'Partial' },
        { type: 'text-delta', id: '1', text: ' discarded' },
      ],
      () => controller.abort(),
    );
    await streamBrowserAnswer({
      taskId: 'session',
      task: 'Plan',
      mode: 'plan',
      tabIds: [],
      model: fakeChatModel(),
      signal: controller.signal,
      post: vi.fn(),
    });
    expect(storage.addMessage).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('surfaces a provider error that arrives inside the stream', async () => {
    streaming([{ type: 'error', error: new Error('model unavailable') }]);
    await expect(
      streamBrowserAnswer({
        taskId: 'session',
        task: 'Hi',
        mode: 'chat',
        tabIds: [],
        model: fakeChatModel(),
        signal: new AbortController().signal,
        post: vi.fn(),
      }),
    ).rejects.toThrow('model unavailable');
    expect(storage.addMessage).not.toHaveBeenCalled();
  });
});
