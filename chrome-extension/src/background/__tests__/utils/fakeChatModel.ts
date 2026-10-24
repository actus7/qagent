import type { LanguageModel } from 'ai';
import type { ChatModel } from '../../agent/helper';

/** A ChatModel whose model is never called directly; tests mock `generateText`/`streamText` from `ai` instead. */
export const fakeChatModel = (modelName = 'test-model', provider = ''): ChatModel => ({
  model: { modelId: modelName } as unknown as LanguageModel,
  modelName,
  provider,
  settings: {},
});
