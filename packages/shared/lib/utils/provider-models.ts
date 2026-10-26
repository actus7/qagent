/**
 * Provider type values, mirroring ProviderTypeEnum in @extension/storage. Kept local so that importing
 * @extension/shared does not load storage (some test suites mock storage without this enum).
 */
const ProviderType = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  DeepSeek: 'deepseek',
  Gemini: 'gemini',
  Grok: 'grok',
  Ollama: 'ollama',
  AzureOpenAI: 'azure_openai',
  OpenRouter: 'openrouter',
  Groq: 'groq',
  Cerebras: 'cerebras',
  Llama: 'llama',
} as const;

export const PROVIDER_MODELS_TIMEOUT_MS = 15_000;

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

/** Base URLs used when the provider config has none. Mirrors the SDK defaults used by chrome-extension/src/background/agent/helper.ts. */
const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<string, string>> = {
  [ProviderType.OpenAI]: 'https://api.openai.com/v1',
  [ProviderType.DeepSeek]: 'https://api.deepseek.com',
  [ProviderType.Grok]: 'https://api.x.ai/v1',
  [ProviderType.Groq]: 'https://api.groq.com/openai/v1',
  [ProviderType.Cerebras]: 'https://api.cerebras.ai/v1',
  [ProviderType.OpenRouter]: 'https://openrouter.ai/api/v1',
  [ProviderType.Llama]: 'https://api.llama.com/v1',
};

export type ProviderModelsErrorCode =
  | 'missingBaseUrl'
  | 'invalidBaseUrl'
  | 'unauthorized'
  | 'http'
  | 'network'
  | 'timeout'
  | 'invalidResponse'
  | 'unsupported';

/** Error with a stable code for the UI to translate. Never carries the API key or the request URL. */
export class ProviderModelsError extends Error {
  readonly code: ProviderModelsErrorCode;
  readonly status?: number;

  constructor(code: ProviderModelsErrorCode, status?: number) {
    super(code);
    this.name = 'ProviderModelsError';
    this.code = code;
    this.status = status;
  }
}

export interface ProviderModelsSource {
  type: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface FetchProviderModelsOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

/** Sorts and dedupes model ids, dropping empty values. */
export function normalizeModelIds(ids: string[]): string[] {
  const unique = new Set(ids.map(id => id.trim()).filter(id => id.length > 0));
  return [...unique].sort();
}

function parseHttpBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderModelsError('invalidBaseUrl');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderModelsError('invalidBaseUrl');
  }
  return raw.replace(/\/+$/, '');
}

function resolveOpenAICompatibleBaseUrl(type: string, baseUrl: string | undefined): string {
  const raw = baseUrl?.trim() || DEFAULT_OPENAI_COMPATIBLE_BASE_URLS[type];
  if (!raw) {
    throw new ProviderModelsError('missingBaseUrl');
  }
  return parseHttpBaseUrl(raw);
}

/** GETs a JSON document, mapping HTTP, network, timeout and parse failures to ProviderModelsError codes. */
async function requestJson(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      throw new ProviderModelsError('unauthorized', response.status);
    }
    if (!response.ok) {
      throw new ProviderModelsError('http', response.status);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderModelsError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ProviderModelsError('timeout');
    }
    if (error instanceof SyntaxError) {
      throw new ProviderModelsError('invalidResponse');
    }
    throw new ProviderModelsError('network');
  } finally {
    clearTimeout(timer);
  }
}

/** Reads `json[listKey][].[field]` as strings. Items without a string field are skipped. */
function readStringField(json: unknown, listKey: string, field: string): string[] {
  const list = isRecord(json) ? json[listKey] : undefined;
  if (!Array.isArray(list)) {
    throw new ProviderModelsError('invalidResponse');
  }
  return list.flatMap(item => {
    const value = isRecord(item) ? item[field] : undefined;
    return typeof value === 'string' ? [value] : [];
  });
}

/** Gemini returns many models that cannot generate content (embeddings, etc.). Keeps only generateContent models. */
function readGeminiModels(json: unknown): string[] {
  const list = isRecord(json) ? json.models : undefined;
  if (!Array.isArray(list)) {
    throw new ProviderModelsError('invalidResponse');
  }
  return list.flatMap(item => {
    if (!isRecord(item) || typeof item.name !== 'string') {
      return [];
    }
    const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
    if (!methods.includes('generateContent')) {
      return [];
    }
    return [item.name.replace(/^models\//, '')];
  });
}

async function fetchOpenAICompatible(
  source: ProviderModelsSource,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  const baseUrl = resolveOpenAICompatibleBaseUrl(source.type, source.baseUrl);
  const apiKey = source.apiKey?.trim();
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const json = await requestJson(`${baseUrl}/models`, headers, fetchImpl, timeoutMs);
  return readStringField(json, 'data', 'id');
}

async function fetchAnthropic(
  source: ProviderModelsSource,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  const json = await requestJson(
    ANTHROPIC_MODELS_URL,
    {
      'x-api-key': source.apiKey?.trim() ?? '',
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    fetchImpl,
    timeoutMs,
  );
  return readStringField(json, 'data', 'id');
}

async function fetchGemini(
  source: ProviderModelsSource,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  // The key goes in a header rather than the ?key= query so it never shows up in URLs.
  const json = await requestJson(
    GEMINI_MODELS_URL,
    { 'x-goog-api-key': source.apiKey?.trim() ?? '' },
    fetchImpl,
    timeoutMs,
  );
  return readGeminiModels(json);
}

async function fetchOllama(
  source: ProviderModelsSource,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  const baseUrl = parseHttpBaseUrl(source.baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL);
  const json = await requestJson(`${baseUrl}/api/tags`, {}, fetchImpl, timeoutMs);
  return readStringField(json, 'models', 'name');
}

/**
 * Lists the model ids a provider currently serves, sorted and deduped.
 * Azure OpenAI is not supported: its deployments are user-named, not listed by the data-plane API.
 */
export async function fetchProviderModels(
  source: ProviderModelsSource,
  options: FetchProviderModelsOptions = {},
): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROVIDER_MODELS_TIMEOUT_MS;

  let ids: string[];
  switch (source.type) {
    case ProviderType.AzureOpenAI:
      throw new ProviderModelsError('unsupported');
    case ProviderType.Anthropic:
      ids = await fetchAnthropic(source, fetchImpl, timeoutMs);
      break;
    case ProviderType.Gemini:
      ids = await fetchGemini(source, fetchImpl, timeoutMs);
      break;
    case ProviderType.Ollama:
      ids = await fetchOllama(source, fetchImpl, timeoutMs);
      break;
    default:
      // OpenAI, CustomOpenAI, DeepSeek, Grok, Groq, Cerebras, Llama, OpenRouter and other OpenAI-compatible endpoints
      ids = await fetchOpenAICompatible(source, fetchImpl, timeoutMs);
  }
  return normalizeModelIds(ids);
}
