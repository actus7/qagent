import { afterEach, describe, expect, it, vi } from 'vitest';
import { inferMode, resolveMode, JEV_API_URL } from '@extension/shared';

const jev = { apiKey: 'sk-test', model: 'jev-latest' };

const jevReply = (choice: string, confidence: number) =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ answers: { mode: { type: 'choice', choice, confidence, probabilities: {} } } }),
  }));

describe('inferMode (verb heuristic)', () => {
  it.each([
    ['Explicar pra mim o que é esses material de apoio', 'chat'],
    ['Resuma esta página e destaque os pontos principais.', 'chat'],
    ['Qual é o prazo?', 'chat'],
    ['Explique como clicar aqui', 'chat'],
    ['Crie um plano passo a passo para pesquisar o assunto', 'plan'],
    ['Ajude-me a realizar a seguinte tarefa nesta página: x', 'act'],
    ['Clique no botão Anexar', 'act'],
    ['pode preencher o formulário?', 'act'],
    ['Executar este plano:\n\n1.', 'act'],
    ['Open the settings page', 'act'],
    ['clicker games are fun', 'chat'],
    ['Quantas aulas tem o ultimo módulo, use meu navegador', 'act'],
    ['How many lessons are left? Use the browser', 'act'],
    ['Qual o melhor navegador para estudar?', 'chat'],
    ['Use meu navegadot e me diga se esta tudo congigurado coretamente', 'act'],
    ['use o navegadr e confira o carrinho', 'act'],
    ['Teste o fluxo de login', 'act'],
    ['Test the checkout flow', 'act'],
    ['Qual navegação faz mais sentido aqui?', 'chat'],
  ])('%s → %s', (text, expected) => {
    expect(inferMode(text)).toBe(expected);
  });

  it('keeps the previous mode for short replies and resets it for long ones', () => {
    expect(inferMode('sim', 'act')).toBe('act');
    expect(inferMode('o que significa isso tudo aqui', 'act')).toBe('chat');
  });
});

describe('resolveMode (Jev with heuristic fallback)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not call Jev without an API key', async () => {
    const fetch = jevReply('act', 1);
    vi.stubGlobal('fetch', fetch);
    expect(await resolveMode('Qual é o prazo?', 'chat', { apiKey: '', model: 'jev-latest' })).toBe('chat');
    expect(await resolveMode('Qual é o prazo?', 'chat', null)).toBe('chat');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the confident Jev choice over the heuristic', async () => {
    const fetch = jevReply('act', 0.92);
    vi.stubGlobal('fetch', fetch);
    expect(await resolveMode('quero que você clique em enviar', 'chat', jev)).toBe('act');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_API_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.state).toEqual({ message: 'quero que você clique em enviar', previous_mode: 'chat' });
    expect(body.questions.mode.type).toBe('choice');
  });

  it('falls back to the heuristic when Jev is not confident', async () => {
    vi.stubGlobal('fetch', jevReply('act', 0.3));
    expect(await resolveMode('Qual é o prazo?', 'chat', jev)).toBe('chat');
  });

  it('falls back to the heuristic and reports the error when Jev fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    const onError = vi.fn();
    expect(await resolveMode('Clique no botão Anexar', 'chat', jev, onError)).toBe('act');
    expect(onError).toHaveBeenCalledOnce();
  });
});
