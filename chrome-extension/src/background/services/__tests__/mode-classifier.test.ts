import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@extension/storage', () => ({ jevStore: { getConfig: vi.fn() } }));
vi.mock('../assistant-model', () => ({ loadAssistantModel: vi.fn() }));
vi.mock('../../log', () => ({ createLogger: () => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

import { jevStore } from '@extension/storage';
import { loadAssistantModel } from '../assistant-model';
import { classifyMode } from '../mode-classifier';

const getConfig = vi.mocked(jevStore.getConfig);
const loadModel = vi.mocked(loadAssistantModel);

const modelReplying = (content: string) => ({ invoke: vi.fn(async () => ({ content })) });

describe('classifyMode', () => {
  beforeEach(() => {
    getConfig.mockResolvedValue({ apiKey: '', model: 'jev-latest' });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('trusts the verb heuristic without calling any model', async () => {
    expect(await classifyMode('Clique no botão Anexar', 'chat', 'navigator')).toBe('act');
    expect(await classifyMode('Me leve até as variáveis de ambiente', 'chat', 'navigator')).toBe('act');
    expect(await classifyMode('quero que você abra o GitHub', 'chat', 'navigator')).toBe('act');
    expect(await classifyMode('Crie um plano para testar o login', 'chat', 'navigator')).toBe('plan');
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('keeps the previous mode for short follow-ups without calling any model', async () => {
    expect(await classifyMode('sim', 'act', 'navigator')).toBe('act');
    expect(loadModel).not.toHaveBeenCalled();
  });

  it("asks the user's model when the heuristic has no verb to go on", async () => {
    const model = modelReplying('act');
    loadModel.mockResolvedValue(model as never);
    expect(await classifyMode('Me meve até a definição de variáveis de ambiente', 'chat', 'planner')).toBe('act');
    expect(loadModel).toHaveBeenCalledWith('planner');
    const [messages] = model.invoke.mock.calls[0] as unknown as [{ content: string }[]];
    expect(messages[1].content).toBe('Me meve até a definição de variáveis de ambiente');
  });

  it('accepts a chatty reply as long as it contains one mode word', async () => {
    loadModel.mockResolvedValue(modelReplying('Mode: **chat**.') as never);
    expect(await classifyMode('Explicar pra mim o que é esse material de apoio', 'act', 'navigator')).toBe('chat');
  });

  it('falls back to the heuristic when the model reply is unusable or the model fails', async () => {
    loadModel.mockResolvedValue(modelReplying('I am not sure') as never);
    expect(await classifyMode('o que significa isso tudo aqui', 'act', 'navigator')).toBe('chat');
    loadModel.mockRejectedValue(new Error('no model configured'));
    expect(await classifyMode('o que significa isso tudo aqui', 'act', 'navigator')).toBe('chat');
  });

  it('prefers Jev over the model when a key is configured', async () => {
    getConfig.mockResolvedValue({ apiKey: 'sk-test', model: 'jev-latest' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          answers: { mode: { type: 'choice', choice: 'act', confidence: 0.9, probabilities: {} } },
        }),
      })),
    );
    expect(await classifyMode('Me meve até a definição de variáveis de ambiente', 'chat', 'navigator')).toBe('act');
    expect(loadModel).not.toHaveBeenCalled();
  });
});
