import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneralSettingsConfig } from '@extension/storage';
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
