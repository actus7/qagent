import { describe, it, expect, vi } from 'vitest';
import { ProviderTypeEnum } from '@extension/storage';
import { fetchProviderModels, normalizeModelIds, ProviderModelsError } from '@extension/shared';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn<typeof fetch>(async () => (typeof response === 'function' ? response() : response.clone()));
}

async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderModelsError);
  expect((error as ProviderModelsError).code).toBe(code);
}

describe('fetchProviderModels', () => {
  it('reads data[].id from an OpenAI-compatible endpoint with a bearer key and the default base URL', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }] }));

    const models = await fetchProviderModels({ type: ProviderTypeEnum.OpenAI, apiKey: ' sk-test ' }, { fetchImpl });

    expect(models).toEqual(['gpt-4.1', 'gpt-4o']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init?.headers).toEqual({ Authorization: 'Bearer sk-test' });
  });

  it('uses the configured base URL without a trailing slash for custom OpenAI-compatible providers', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: 'local-model' }] }));

    await fetchProviderModels(
      { type: ProviderTypeEnum.CustomOpenAI, apiKey: '', baseUrl: 'https://proxy.example.com/v1/' },
      { fetchImpl },
    );

    expect(fetchImpl.mock.calls[0][0]).toBe('https://proxy.example.com/v1/models');
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({});
  });

  it('fails with missingBaseUrl for a custom provider without a base URL', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [] }));

    await expectErrorCode(
      fetchProviderModels({ type: ProviderTypeEnum.CustomOpenAI, apiKey: 'k' }, { fetchImpl }),
      'missingBaseUrl',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-http base URLs with invalidBaseUrl', async () => {
    await expectErrorCode(
      fetchProviderModels(
        { type: ProviderTypeEnum.CustomOpenAI, baseUrl: 'ftp://x.example.com' },
        {
          fetchImpl: mockFetch(jsonResponse({ data: [] })),
        },
      ),
      'invalidBaseUrl',
    );
  });

  it('sends the Anthropic headers and reads data[].id', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: 'claude-sonnet-4-5' }], has_more: false }));

    const models = await fetchProviderModels({ type: ProviderTypeEnum.Anthropic, apiKey: 'ak' }, { fetchImpl });

    expect(models).toEqual(['claude-sonnet-4-5']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(init?.headers).toMatchObject({
      'x-api-key': 'ak',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('keeps only Gemini models that support generateContent and strips the models/ prefix', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    );

    const models = await fetchProviderModels({ type: ProviderTypeEnum.Gemini, apiKey: 'gk' }, { fetchImpl });

    expect(models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ 'x-goog-api-key': 'gk' });
  });

  it('reads models[].name from Ollama /api/tags on the configured server', async () => {
    const fetchImpl = mockFetch(jsonResponse({ models: [{ name: 'qwen3:latest' }, { name: 'llama3:8b' }] }));

    const models = await fetchProviderModels(
      { type: ProviderTypeEnum.Ollama, apiKey: 'ollama', baseUrl: 'http://localhost:11434' },
      { fetchImpl },
    );

    expect(models).toEqual(['llama3:8b', 'qwen3:latest']);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });

  it('maps 401 and 403 to unauthorized and other statuses to http, without leaking the key', async () => {
    const unauthorized = mockFetch(jsonResponse({ error: 'bad key' }, 401));
    const error = await fetchProviderModels(
      { type: ProviderTypeEnum.DeepSeek, apiKey: 'secret-key' },
      {
        fetchImpl: unauthorized,
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderModelsError);
    expect((error as ProviderModelsError).code).toBe('unauthorized');
    expect(String((error as Error).message)).not.toContain('secret-key');

    await expectErrorCode(
      fetchProviderModels(
        { type: ProviderTypeEnum.Grok, apiKey: 'k' },
        { fetchImpl: mockFetch(jsonResponse({}, 403)) },
      ),
      'unauthorized',
    );
    await expectErrorCode(
      fetchProviderModels(
        { type: ProviderTypeEnum.Groq, apiKey: 'k' },
        { fetchImpl: mockFetch(jsonResponse({}, 500)) },
      ),
      'http',
    );
  });

  it('maps a failed request to network and an unparseable body or wrong shape to invalidResponse', async () => {
    const offline = mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expectErrorCode(
      fetchProviderModels({ type: ProviderTypeEnum.Cerebras, apiKey: 'k' }, { fetchImpl: offline }),
      'network',
    );

    const notJson = mockFetch(async () => new Response('<html>', { status: 200 }));
    await expectErrorCode(
      fetchProviderModels({ type: ProviderTypeEnum.Cerebras, apiKey: 'k' }, { fetchImpl: notJson }),
      'invalidResponse',
    );

    const wrongShape = mockFetch(jsonResponse({ items: [] }));
    await expectErrorCode(
      fetchProviderModels({ type: ProviderTypeEnum.Cerebras, apiKey: 'k' }, { fetchImpl: wrongShape }),
      'invalidResponse',
    );
  });

  it('aborts a request that exceeds the timeout', async () => {
    const hangs = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    await expectErrorCode(
      fetchProviderModels({ type: ProviderTypeEnum.OpenAI, apiKey: 'k' }, { fetchImpl: hangs, timeoutMs: 5 }),
      'timeout',
    );
  });

  it('refuses Azure OpenAI because deployments are user-named', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [] }));
    await expectErrorCode(
      fetchProviderModels(
        { type: ProviderTypeEnum.AzureOpenAI, apiKey: 'k', baseUrl: 'https://x.openai.azure.com' },
        { fetchImpl },
      ),
      'unsupported',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('normalizeModelIds', () => {
  it('dedupes, trims, drops empty ids and sorts', () => {
    expect(normalizeModelIds([' b ', 'a', 'b', '', '  ', 'C'])).toEqual(['C', 'a', 'b']);
  });
});
