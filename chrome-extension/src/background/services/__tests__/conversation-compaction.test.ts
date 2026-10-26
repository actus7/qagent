import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Actors, type ChatMessage } from '@extension/storage';
import type * as StorageModule from '@extension/storage';
import type * as CompactionModule from '../conversation-compaction';
import { installChromeStorageMock } from '../../__tests__/utils/chromeStorageMock';
import { fakeChatModel } from '../../__tests__/utils/fakeChatModel';
import { COMPACTION_KIND, needsAutoCompaction, selectContext, trimToBudget } from '../conversation-compaction';

// One mock instance shared with the modules re-imported after vi.resetModules()
const ai = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', () => ai);

const message = (actor: Actors, content: string, kind?: ChatMessage['kind']): ChatMessage => ({
  id: crypto.randomUUID(),
  actor,
  content,
  timestamp: 1,
  ...(kind ? { kind } : {}),
});

const fakeModel = (reply: string) => {
  ai.generateText.mockReset().mockResolvedValue({ text: reply });
  return { model: fakeChatModel(), invoke: ai.generateText };
};

describe('selectContext', () => {
  it('uses the newest summary and only the dialog messages after it', () => {
    const messages = [
      message(Actors.USER, 'old question'),
      message(Actors.SYSTEM, 'summary v1', COMPACTION_KIND),
      message(Actors.USER, 'new question'),
      message(Actors.ASSISTANT, 'new answer'),
    ];

    const context = selectContext(messages);

    expect(context.summary).toBe('summary v1');
    expect(context.recent.map(item => item.content)).toEqual(['new question', 'new answer']);
  });

  it('returns no summary when the chat was never compacted', () => {
    const context = selectContext([message(Actors.USER, 'hi'), message(Actors.ASSISTANT, 'hello')]);

    expect(context.summary).toBeNull();
    expect(context.recent).toHaveLength(2);
  });
});

describe('trimToBudget and needsAutoCompaction', () => {
  it('keeps the newest messages that fit the budget', () => {
    const messages = [message(Actors.USER, 'a'.repeat(10)), message(Actors.USER, 'b'.repeat(10))];

    expect(trimToBudget(messages, 15).map(item => item.content)).toEqual(['b'.repeat(10)]);
  });

  it('always keeps the newest message even when it alone exceeds the budget', () => {
    expect(trimToBudget([message(Actors.USER, 'x'.repeat(50))], 10)).toHaveLength(1);
  });

  it('requests compaction only when the context passes the budget', () => {
    const small = [message(Actors.USER, 'a'.repeat(100))];
    const large = [message(Actors.USER, 'a'.repeat(100)), message(Actors.ASSISTANT, 'b'.repeat(100))];

    expect(needsAutoCompaction(small, 150)).toBe(false);
    expect(needsAutoCompaction(large, 150)).toBe(true);
  });

  it('counts the stored summary toward the budget', () => {
    const messages = [message(Actors.SYSTEM, 'z'.repeat(200), COMPACTION_KIND)];

    expect(needsAutoCompaction(messages, 150)).toBe(true);
  });
});

describe('compactChatConversation', () => {
  // The storage modules read chrome.storage when they load, so each test loads them after installing the mock.
  let chatHistoryStore: typeof StorageModule.chatHistoryStore;
  let compactChatConversation: typeof CompactionModule.compactChatConversation;
  let compactIfNeeded: typeof CompactionModule.compactIfNeeded;

  beforeEach(async () => {
    vi.resetModules();
    installChromeStorageMock();
    ({ chatHistoryStore } = await import('@extension/storage'));
    ({ compactChatConversation, compactIfNeeded } = await import('../conversation-compaction'));
  });

  it('stores the model summary as a compaction message and keeps the full history', async () => {
    // Arrange
    const session = await chatHistoryStore.createSession('chat');
    await chatHistoryStore.addMessage(session.id, { actor: Actors.USER, content: 'open the docs', timestamp: 1 });
    await chatHistoryStore.addMessage(session.id, { actor: Actors.ASSISTANT, content: 'opened', timestamp: 2 });
    const { model, invoke } = fakeModel('User asked to open the docs; assistant opened them.');

    // Act
    const compacted = await compactChatConversation(session.id, model);

    // Assert
    expect(compacted).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].prompt).toContain('User: open the docs');
    const stored = (await chatHistoryStore.getSession(session.id))?.messages ?? [];
    expect(stored).toHaveLength(3);
    expect(stored[2]).toMatchObject({ kind: COMPACTION_KIND, actor: Actors.SYSTEM });
    expect(stored[2]?.kind).toBe(COMPACTION_KIND);
  });

  it('does nothing when there is no new message since the last summary', async () => {
    const session = await chatHistoryStore.createSession('chat');
    const { model, invoke } = fakeModel('unused');

    expect(await compactChatConversation(session.id, model)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses an empty summary instead of storing it', async () => {
    const session = await chatHistoryStore.createSession('chat');
    await chatHistoryStore.addMessage(session.id, { actor: Actors.USER, content: 'hi', timestamp: 1 });
    const { model } = fakeModel('   ');

    await expect(compactChatConversation(session.id, model)).rejects.toThrow();
    const stored = (await chatHistoryStore.getSession(session.id))?.messages ?? [];
    expect(stored.some(item => item.kind === COMPACTION_KIND)).toBe(false);
  });

  it('compacts automatically only when the chat is over budget', async () => {
    const session = await chatHistoryStore.createSession('chat');
    await chatHistoryStore.addMessage(session.id, { actor: Actors.USER, content: 'short', timestamp: 1 });
    const { model, invoke } = fakeModel('summary');

    expect(await compactIfNeeded(session.id, model)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    await chatHistoryStore.addMessage(session.id, {
      actor: Actors.USER,
      content: 'x'.repeat(30000),
      timestamp: 2,
    });
    expect(await compactIfNeeded(session.id, model)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
