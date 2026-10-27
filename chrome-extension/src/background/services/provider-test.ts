import { generateText } from 'ai';
import { llmProviderStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { createChatModel } from '../agent/helper';
import { describeModelError } from '../agent/agents/errors';
import { createLogger } from '../log';

const logger = createLogger('background');
const PROVIDER_TEST_TIMEOUT_MS = 20_000;

export type ProviderTestResult = { ok: true } | { ok: false; error: string };

/**
 * Sends one minimal completion through the saved provider configuration. The API key is read from storage here and
 * never returned, logged, or echoed in the error text.
 */
export async function testProviderConnection(
  providerId: string,
  timeoutMs = PROVIDER_TEST_TIMEOUT_MS,
): Promise<ProviderTestResult> {
  const providers = await llmProviderStore.getAllProviders();
  const provider = providers[providerId];
  if (!provider) return { ok: false, error: t('options_test_noProvider') };
  const modelName = provider.modelNames?.[0];
  if (!modelName) return { ok: false, error: t('options_test_noModel') };

  const chat = createChatModel(provider, { provider: providerId, modelName });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await generateText({
      model: chat.model,
      ...chat.settings,
      prompt: 'Reply with the word OK.',
      abortSignal: controller.signal,
      maxRetries: 0,
    });
    logger.info(`Connection test passed for provider ${providerId}`);
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: t('options_test_timeout') };
    logger.warning(`Connection test failed for provider ${providerId}`);
    return { ok: false, error: describeModelError(error, t) };
  } finally {
    clearTimeout(timer);
  }
}
