import {
  type ProviderConfig,
  type ModelConfig,
  ProviderTypeEnum,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from '@extension/storage';
import type { LanguageModel, LanguageModelCallOptions } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAzure } from '@ai-sdk/azure';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createGroq } from '@ai-sdk/groq';
import { createCerebras } from '@ai-sdk/cerebras';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createLogger } from '@src/background/log';
import type { ModelFailover } from './model-failover';

const logger = createLogger('agent/helper');

const maxOutputTokens = 1024 * 4;

/** Per-call sampling settings; the AI SDK takes them on each call rather than on the model. */
export type ChatModelSettings = Pick<
  LanguageModelCallOptions,
  'temperature' | 'topP' | 'maxOutputTokens' | 'reasoning'
>;

/** A configured language model plus what the agents need to know about it. */
export interface ChatModel {
  model: LanguageModel;
  modelName: string;
  /** Provider id from the model config (e.g. `custom_openai_2`). */
  provider: string;
  settings: ChatModelSettings;
  /** Set when other configured models can take over if this one fails (see ModelFailover). */
  failover?: ModelFailover;
}

interface LlamaApiResponse {
  id?: string;
  completion_message?: { content?: { text?: string }; stop_reason?: string };
  metrics?: Array<{ metric?: string; value?: number }>;
}

/**
 * Llama API answers in its own shape (`completion_message`) instead of OpenAI's `choices`. Non-streaming JSON
 * responses are rewritten to the OpenAI shape; anything else (streams, errors) passes through untouched.
 */
const llamaFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) return response;
  const text = await response.text();
  try {
    const llama = JSON.parse(text) as LlamaApiResponse;
    const completionText = llama.completion_message?.content?.text;
    if (typeof completionText !== 'string') return new Response(text, response);
    const metric = (name: string) => llama.metrics?.find(item => item.metric === name)?.value ?? 0;
    const body = {
      id: llama.id ?? 'llama-response',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: completionText },
          finish_reason: llama.completion_message?.stop_reason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: metric('num_prompt_tokens'),
        completion_tokens: metric('num_completion_tokens'),
        total_tokens: metric('num_total_tokens'),
      },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    logger.error('[Llama] Could not read the API response:', error);
    return new Response(text, response);
  }
};

// O series models (o1, o3, o4-mini, ...) or GPT-5 models that support reasoning
function isOpenAIReasoningModel(modelName: string): boolean {
  const name = modelName.startsWith('openai/') ? modelName.substring(7) : modelName;
  return /^o\d/.test(name) || (name.startsWith('gpt-5') && !name.startsWith('gpt-5-chat'));
}

function resolveReasoningEffortForModel(
  modelName: string,
  reasoningEffort: unknown,
): 'none' | ReasoningEffort | undefined {
  const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);
  if (!normalizedReasoningEffort) {
    return undefined;
  }

  // GPT-5.1 only accepts "none" instead of "minimal"
  if (modelName.includes('gpt-5.1') && normalizedReasoningEffort === 'minimal') {
    return 'none';
  }

  return normalizedReasoningEffort;
}

const samplingSettings = (modelConfig: ModelConfig, withMaxTokens = true): ChatModelSettings => ({
  temperature: (modelConfig.parameters?.temperature ?? 0.1) as number,
  topP: (modelConfig.parameters?.topP ?? 0.1) as number,
  ...(withMaxTokens ? { maxOutputTokens } : {}),
});

/** Reasoning models take an effort level instead of sampling parameters. */
const openAISettings = (modelConfig: ModelConfig, modelName: string): ChatModelSettings => {
  if (!isOpenAIReasoningModel(modelName)) return samplingSettings(modelConfig);
  const reasoning = resolveReasoningEffortForModel(modelName, modelConfig.reasoningEffort);
  return { maxOutputTokens, ...(reasoning ? { reasoning } : {}) };
};

function createOpenAICompatibleModel(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
  options: { name: string; defaultBaseUrl?: string; headers?: Record<string, string>; fetch?: typeof fetch } = {
    name: modelConfig.provider,
  },
): ChatModel {
  const provider = createOpenAICompatible({
    name: options.name,
    baseURL: providerConfig.baseUrl || options.defaultBaseUrl || 'https://api.openai.com/v1',
    // custom provider may have no api key
    ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    model: provider.chatModel(modelConfig.modelName),
    modelName: modelConfig.modelName,
    provider: modelConfig.provider,
    settings: openAISettings(modelConfig, modelConfig.modelName),
  };
}

// Function to extract instance name from Azure endpoint URL
function extractInstanceNameFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const hostnameParts = parsedUrl.hostname.split('.');
    // Expecting format like instance-name.openai.azure.com
    if (hostnameParts.length >= 4 && hostnameParts[1] === 'openai' && hostnameParts[2] === 'azure') {
      return hostnameParts[0];
    }
  } catch (e) {
    logger.error('Error parsing Azure endpoint URL:', e);
  }
  return null;
}

// Function to check if a provider ID is an Azure provider
function isAzureProvider(providerId: string): boolean {
  return providerId === ProviderTypeEnum.AzureOpenAI || providerId.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`);
}

// Function to create an Azure OpenAI chat model
function createAzureChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): ChatModel {
  // Validate necessary fields first
  if (
    !providerConfig.baseUrl ||
    !providerConfig.azureDeploymentNames ||
    providerConfig.azureDeploymentNames.length === 0 ||
    !providerConfig.azureApiVersion ||
    !providerConfig.apiKey
  ) {
    throw new Error(
      'A configuração do Azure está incompleta. Endpoint, Nome da Implantação, Versão da API e Chave de API são obrigatórios. Por favor, verifique as configurações.',
    );
  }

  // The model name from modelConfig is the deployment selected in the UI
  const deploymentName = modelConfig.modelName;

  // Validate that the selected model exists in the configured deployments
  if (!providerConfig.azureDeploymentNames.includes(deploymentName)) {
    logger.warning(
      `[createChatModel] Selected deployment "${deploymentName}" not found in available deployments. ` +
        `Available: ${JSON.stringify(providerConfig.azureDeploymentNames)}. Using the model anyway.`,
    );
  }

  // Extract instance name from the endpoint URL
  const instanceName = extractInstanceNameFromUrl(providerConfig.baseUrl);
  if (!instanceName) {
    throw new Error(
      `Não foi possível extrair o Nome da Instância da URL do Endpoint Azure: ${providerConfig.baseUrl}. Formato esperado como https://<seu-nome-de-instancia>.openai.azure.com/`,
    );
  }

  const azure = createAzure({
    resourceName: instanceName,
    apiKey: providerConfig.apiKey,
    apiVersion: providerConfig.azureApiVersion,
  });
  return {
    model: azure.chat(deploymentName),
    modelName: deploymentName,
    provider: modelConfig.provider,
    settings: openAISettings(modelConfig, deploymentName),
  };
}

// create a chat model based on the agent name, the model name and provider
export function createChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): ChatModel {
  const { modelName, provider } = modelConfig;
  const base = { modelName, provider };
  const apiKey = providerConfig.apiKey;

  // Check if the provider is an Azure provider with a custom ID (e.g. azure_openai_2)
  if (isAzureProvider(provider)) {
    return createAzureChatModel(providerConfig, modelConfig);
  }

  switch (provider) {
    case ProviderTypeEnum.OpenAI: {
      const openai = createOpenAI({ apiKey, ...(providerConfig.baseUrl ? { baseURL: providerConfig.baseUrl } : {}) });
      return { ...base, model: openai.chat(modelName), settings: openAISettings(modelConfig, modelName) };
    }
    case ProviderTypeEnum.Anthropic: {
      // Opus and 4.5 models accept temperature or topP, not both; temperature is used for all of them
      const { topP: _topP, ...settings } = samplingSettings(modelConfig);
      void _topP;
      return { ...base, model: createAnthropic({ apiKey })(modelName), settings };
    }
    case ProviderTypeEnum.DeepSeek: {
      return { ...base, model: createDeepSeek({ apiKey })(modelName), settings: samplingSettings(modelConfig, false) };
    }
    case ProviderTypeEnum.Gemini: {
      return {
        ...base,
        model: createGoogleGenerativeAI({ apiKey })(modelName),
        settings: samplingSettings(modelConfig, false),
      };
    }
    case ProviderTypeEnum.Grok: {
      return { ...base, model: createXai({ apiKey })(modelName), settings: samplingSettings(modelConfig) };
    }
    case ProviderTypeEnum.Groq: {
      return { ...base, model: createGroq({ apiKey })(modelName), settings: samplingSettings(modelConfig) };
    }
    case ProviderTypeEnum.Cerebras: {
      return { ...base, model: createCerebras({ apiKey })(modelName), settings: samplingSettings(modelConfig) };
    }
    case ProviderTypeEnum.Ollama: {
      // ponytail: Ollama's OpenAI-compatible endpoint cannot set num_ctx; set the context window on the Ollama
      // model itself (Modelfile `PARAMETER num_ctx`) or add a native Ollama provider if that proves too limiting.
      return createOpenAICompatibleModel(
        {
          ...providerConfig,
          apiKey: apiKey || 'ollama',
          baseUrl: `${providerConfig.baseUrl ?? 'http://localhost:11434'}/v1`,
        },
        modelConfig,
        { name: 'ollama' },
      );
    }
    case ProviderTypeEnum.OpenRouter: {
      return createOpenAICompatibleModel(providerConfig, modelConfig, {
        name: 'openrouter',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        headers: { 'HTTP-Referer': 'https://qagent.ai', 'X-Title': 'QAgent' },
      });
    }
    case ProviderTypeEnum.Llama: {
      // Llama API has a different response format, rewritten by llamaFetch
      return createOpenAICompatibleModel(providerConfig, modelConfig, { name: 'llama', fetch: llamaFetch });
    }
    default: {
      // by default, we think it's a openai-compatible provider
      return createOpenAICompatibleModel(providerConfig, modelConfig);
    }
  }
}
