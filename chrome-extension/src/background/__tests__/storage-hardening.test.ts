import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Actors, type GeneralSettingsConfig } from '@extension/storage';
import { installChromeStorageMock } from './utils/chromeStorageMock';

describe('general settings hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorageMock();
  });

  it('sanitizes numeric settings and rejects NaN/invalid values', async () => {
    const { DEFAULT_GENERAL_SETTINGS, generalSettingsStore } = await import('@extension/storage');

    await generalSettingsStore.updateSettings({
      maxSteps: Number.NaN,
      maxActionsPerStep: 999,
      maxFailures: -4,
      planningInterval: 999,
      minWaitPageLoad: 1,
      language: '   ',
      replayHistoricalTasks: 'true',
      chatDebugMode: 'true',
      useVisionForPlanner: 'yes',
    } as unknown as Partial<GeneralSettingsConfig>);

    const settings = await generalSettingsStore.getSettings();
    expect(settings.maxSteps).toBe(DEFAULT_GENERAL_SETTINGS.maxSteps);
    expect(settings.maxActionsPerStep).toBe(50);
    expect(settings.maxFailures).toBe(1);
    expect(settings.planningInterval).toBe(20);
    expect(settings.minWaitPageLoad).toBe(250);
    expect(settings.language).toBe(DEFAULT_GENERAL_SETTINGS.language);
    expect(settings.replayHistoricalTasks).toBe(DEFAULT_GENERAL_SETTINGS.replayHistoricalTasks);
    expect(settings.chatDebugMode).toBe(DEFAULT_GENERAL_SETTINGS.chatDebugMode);
    expect(settings.useVisionForPlanner).toBe(DEFAULT_GENERAL_SETTINGS.useVisionForPlanner);
  });

  it('enforces displayHighlights when useVision is enabled', async () => {
    const { generalSettingsStore } = await import('@extension/storage');

    await generalSettingsStore.updateSettings({
      useVision: true,
      displayHighlights: false,
    });

    const settings = await generalSettingsStore.getSettings();
    expect(settings.useVision).toBe(true);
    expect(settings.displayHighlights).toBe(true);
  });
});

describe('chat messages across extension contexts', () => {
  it('preserves an answer saved by the service worker before the panel appends a follow-up', async () => {
    vi.resetModules();
    installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const { Actors } = await import('@extension/storage/lib/chat/types');
    const store = createChatHistoryStorage();
    const session = await store.createSession('Conversation');
    await store.addMessage(session.id, { actor: Actors.USER, content: 'First question', timestamp: 1 });
    // A fresh module instance stands in for the service worker: it has its own caches and writes the same storage.
    vi.resetModules();
    const { createChatHistoryStorage: createBackgroundHistory } = await import('@extension/storage/lib/chat/history');
    await createBackgroundHistory().addMessage(session.id, {
      actor: Actors.ASSISTANT,
      content: 'Background answer',
      timestamp: 2,
    });
    await store.addMessage(session.id, { actor: Actors.USER, content: 'Follow-up', timestamp: 3 });
    expect((await store.getSession(session.id))?.messages.map(message => message.content)).toEqual([
      'First question',
      'Background answer',
      'Follow-up',
    ]);
  });
});

describe('chat history memory-leak hardening', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not accumulate storage listeners for per-session histories', async () => {
    const chromeMock = installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const historyStore = createChatHistoryStorage();

    const baseListenerCount = chromeMock.listenerCounts.local();
    expect(baseListenerCount).toBe(1);

    for (let index = 0; index < 10; index++) {
      const session = await historyStore.createSession(`Session ${index}`);
      await historyStore.storeAgentStepHistory(session.id, `task ${index}`, `history-${index}`);
      await historyStore.deleteSession(session.id);
    }

    expect(chromeMock.listenerCounts.local()).toBe(baseListenerCount);
  });

  it('clears agent-step history data on deleteSession and clearAllSessions', async () => {
    installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const historyStore = createChatHistoryStorage();

    const firstSession = await historyStore.createSession('first');
    const secondSession = await historyStore.createSession('second');

    await historyStore.storeAgentStepHistory(firstSession.id, 'task first', '[{"step":1}]');
    await historyStore.storeAgentStepHistory(secondSession.id, 'task second', '[{"step":1}]');

    expect(await historyStore.loadAgentStepHistory(firstSession.id)).not.toBeNull();
    expect(await historyStore.loadAgentStepHistory(secondSession.id)).not.toBeNull();

    await historyStore.deleteSession(firstSession.id);
    expect(await historyStore.loadAgentStepHistory(firstSession.id)).toBeNull();

    await historyStore.clearAllSessions();
    expect(await historyStore.loadAgentStepHistory(secondSession.id)).toBeNull();
  });
});

const messageAt = (index: number) => ({ actor: Actors.USER, content: `m${index}`, timestamp: index });

describe('chat message chunks', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('appends to the last chunk only and reads messages back in order', async () => {
    const chromeMock = installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const store = createChatHistoryStorage();
    const session = await store.createSession('Long');
    for (let index = 0; index < 51; index++) await store.addMessage(session.id, messageAt(index));

    // Chunk 0 is full at 50 messages, so message 51 lands in chunk 1 and only that chunk is written.
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    await store.addMessage(session.id, messageAt(51));
    const writtenKeys = setSpy.mock.calls.flatMap(([items]) => Object.keys(items)).filter(key => key.includes(session.id));
    expect(writtenKeys).toEqual([`chat_chunks_${session.id}_1`]);

    const messages = (await store.getSession(session.id))?.messages ?? [];
    expect(messages.map(message => message.content)).toEqual(Array.from({ length: 52 }, (_, i) => `m${i}`));
    const sessionKeys = Object.keys(chromeMock.storageData.local).filter(key => key.includes(session.id));
    expect(sessionKeys.filter(key => key.startsWith('chat_chunks_'))).toHaveLength(3);
  });

  it('converts a legacy flat array on first access and removes the old key', async () => {
    const chromeMock = installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const store = createChatHistoryStorage();
    const session = await store.createSession('Legacy');
    const legacyKey = `chat_messages_${session.id}`;
    const legacy = [0, 1, 2].map(index => ({ id: `legacy-${index}`, ...messageAt(index), content: `old ${index}` }));
    await chrome.storage.local.set({ [legacyKey]: legacy });

    expect((await store.getSession(session.id))?.messages).toEqual(legacy);
    expect(Object.prototype.hasOwnProperty.call(chromeMock.storageData.local, legacyKey)).toBe(false);

    await store.addMessage(session.id, messageAt(3));
    expect((await store.getSession(session.id))?.messages.map(message => message.content)).toEqual([
      'old 0',
      'old 1',
      'old 2',
      'm3',
    ]);
  });

  it('deleteMessage keeps the order across chunks', async () => {
    installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const store = createChatHistoryStorage();
    const session = await store.createSession('Delete');
    const added: string[] = [];
    for (let index = 0; index < 60; index++) added.push((await store.addMessage(session.id, messageAt(index))).id);

    await store.deleteMessage(session.id, added[0]);
    const messages = (await store.getSession(session.id))?.messages ?? [];
    expect(messages.map(message => message.content)).toEqual(Array.from({ length: 59 }, (_, i) => `m${i + 1}`));
  });

  it('deleteSession removes every chunk and the manifest', async () => {
    const chromeMock = installChromeStorageMock();
    const { createChatHistoryStorage } = await import('@extension/storage/lib/chat/history');
    const store = createChatHistoryStorage();
    const session = await store.createSession('Gone');
    for (let index = 0; index < 120; index++) await store.addMessage(session.id, messageAt(index));

    await store.deleteSession(session.id);
    const leftover = Object.keys(chromeMock.storageData.local).filter(
      key => (key.startsWith('chat_chunks_') || key.startsWith('chat_messages_')) && key.includes(session.id),
    );
    expect(leftover).toEqual([]);
  });
});

describe('capped stores and concurrent defaults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('refuses a new scheduled task past the limit and still updates an existing one', async () => {
    installChromeStorageMock();
    const { scheduledTasksStore, SCHEDULE_LIMIT } = await import('@extension/storage');
    const taskAt = (index: number, name = `task ${index}`) => ({
      id: `task-${index}`,
      name,
      prompt: 'check',
      mode: 'chat' as const,
      startUrl: null,
      enabled: true,
      nextRunAt: null,
      createdAt: index,
      history: [],
      frequency: 'once' as const,
      time: '09:00',
      date: '2030-01-01',
      weekday: 1,
      dayOfMonth: 1,
    });
    for (let index = 0; index < SCHEDULE_LIMIT; index++) await scheduledTasksStore.saveTask(taskAt(index));

    await expect(scheduledTasksStore.saveTask(taskAt(SCHEDULE_LIMIT))).rejects.toThrow(/Schedule limit reached/);
    await scheduledTasksStore.saveTask(taskAt(0, 'renamed'));

    const tasks = await scheduledTasksStore.getTasks();
    expect(tasks).toHaveLength(SCHEDULE_LIMIT);
    expect(tasks[0].name).toBe('renamed');
  });

  it('gives concurrent callers of analytics getSettings one anonymous ID', async () => {
    installChromeStorageMock();
    const { analyticsSettingsStore } = await import('@extension/storage');
    const settings = await Promise.all([1, 2, 3].map(() => analyticsSettingsStore.getSettings()));
    const ids = new Set(settings.map(item => item.anonymousUserId));
    expect(ids.size).toBe(1);
    expect(ids.has('')).toBe(false);
    expect((await analyticsSettingsStore.getSettings()).anonymousUserId).toBe(settings[0].anonymousUserId);
  });

  it('gives a provider saved without createdAt the same deterministic createdAt on every read', async () => {
    installChromeStorageMock();
    await chrome.storage.local.set({ 'llm-api-keys': { providers: { openai: { apiKey: 'key', modelNames: ['m'] } } } });
    const { llmProviderStore } = await import('@extension/storage');
    const first = await llmProviderStore.getProvider('openai');
    const second = await llmProviderStore.getProvider('openai');
    expect(first?.createdAt).toBe(1);
    expect(second?.createdAt).toBe(first?.createdAt);
  });
});
