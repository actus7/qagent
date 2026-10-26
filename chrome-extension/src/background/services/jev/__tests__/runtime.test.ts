import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_JEV_CONFIG, type JevConfig } from '@extension/storage';

const askSystemOne = vi.hoisted(() => vi.fn());
vi.mock('@extension/shared', () => ({ askSystemOne }));
vi.mock('@src/background/log', () => ({
  createLogger: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { decideWithJev, type JevRuntime } from '../runtime';
import { JevTaskMetrics } from '../metrics';

const configWith = (overrides: Partial<JevConfig> = {}): JevConfig => ({
  ...DEFAULT_JEV_CONFIG,
  apiKey: 'test-key',
  features: { ...DEFAULT_JEV_CONFIG.features, doneCheck: true },
  ...overrides,
});

const runtimeWith = (config: JevConfig): JevRuntime => ({
  config,
  metrics: new JevTaskMetrics(),
  task: 'Check the form',
});

const request = { state: { task: 'x' }, questions: { q: { type: 'noul' as const, instructions: 'x' } } };
const decideYes = (answers: Record<string, { type: string; noul?: number }>, threshold: number) =>
  answers.q?.type === 'noul' && (answers.q.noul ?? 0) >= threshold ? 'yes' : null;

describe('decideWithJev', () => {
  beforeEach(() => {
    askSystemOne.mockReset();
  });

  it('returns null without calling Jev when the feature is off', async () => {
    const runtime = runtimeWith(configWith({ features: DEFAULT_JEV_CONFIG.features }));
    await expect(decideWithJev(runtime, 'doneCheck', request, decideYes)).resolves.toBeNull();
    expect(askSystemOne).not.toHaveBeenCalled();
  });

  it('returns the decision and records a hit when Jev is confident', async () => {
    askSystemOne.mockResolvedValue({ q: { type: 'noul', noul: 0.95 } });
    const runtime = runtimeWith(configWith());
    await expect(decideWithJev(runtime, 'doneCheck', request, decideYes)).resolves.toBe('yes');
    expect(runtime.metrics.summary()).toMatchObject({
      jevCalls: 1,
      features: { doneCheck: { hits: 1, fallbacks: 0 } },
    });
  });

  it('falls back and records the fallback when Jev is below the threshold', async () => {
    askSystemOne.mockResolvedValue({ q: { type: 'noul', noul: 0.2 } });
    const runtime = runtimeWith(configWith());
    await expect(decideWithJev(runtime, 'doneCheck', request, decideYes)).resolves.toBeNull();
    expect(runtime.metrics.summary().features.doneCheck).toEqual({ hits: 0, fallbacks: 1 });
  });

  it('falls back silently when the request fails', async () => {
    askSystemOne.mockRejectedValue(new Error('Jev request failed with status 500'));
    const runtime = runtimeWith(configWith());
    await expect(decideWithJev(runtime, 'doneCheck', request, decideYes)).resolves.toBeNull();
    expect(runtime.metrics.summary().features.doneCheck.fallbacks).toBe(1);
  });

  it('falls back without calling Jev when no API key is configured', async () => {
    const runtime = runtimeWith(configWith({ apiKey: '' }));
    await expect(decideWithJev(runtime, 'doneCheck', request, decideYes)).resolves.toBeNull();
    expect(askSystemOne).not.toHaveBeenCalled();
    expect(runtime.metrics.summary().features.doneCheck.fallbacks).toBe(1);
  });
});

describe('JevTaskMetrics', () => {
  it('counts LLM and Jev calls and reports the elapsed time', () => {
    let now = 1000;
    const metrics = new JevTaskMetrics(() => now);
    metrics.recordLlmCall();
    metrics.recordJevCall();
    metrics.recordHit('elementFastPath');
    now = 1750;
    const summary = metrics.summary();
    expect(summary).toMatchObject({ totalMs: 750, llmCalls: 1, jevCalls: 1 });
    expect(summary.features.elementFastPath).toEqual({ hits: 1, fallbacks: 0 });
  });
});
