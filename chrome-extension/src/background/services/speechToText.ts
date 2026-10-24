import { generateText, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createLogger } from '../log';
import { type ProviderConfig, speechToTextModelStore } from '@extension/storage';
import { t } from '@extension/i18n';

const logger = createLogger('SpeechToText');

export class SpeechToTextService {
  private model: LanguageModel;

  private constructor(model: LanguageModel) {
    this.model = model;
  }

  static async create(providers: Record<string, ProviderConfig>): Promise<SpeechToTextService> {
    try {
      const config = await speechToTextModelStore.getSpeechToTextModel();

      if (!config?.provider || !config?.modelName) {
        throw new Error(t('chat_stt_model_notFound'));
      }

      const provider = providers[config.provider];
      logger.info('Found provider for speech-to-text:', provider ? 'yes' : 'no', provider?.type);

      if (!provider || provider.type !== 'gemini') {
        throw new Error(t('chat_stt_model_notFound'));
      }

      const model = createGoogleGenerativeAI({ apiKey: provider.apiKey })(config.modelName);
      logger.info(`Speech-to-text service created with model: ${config.modelName}`);
      return new SpeechToTextService(model);
    } catch (error) {
      logger.error('Failed to create speech-to-text service:', error);
      throw error;
    }
  }

  async transcribeAudio(base64Audio: string): Promise<string> {
    try {
      logger.info('Starting audio transcription...');

      // Get transcription from Gemini
      const response = await generateText({
        model: this.model,
        temperature: 0.1,
        topP: 0.8,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe this audio. Return only the transcribed text without any additional formatting or explanations.',
              },
              { type: 'file', mediaType: 'audio/webm', data: base64Audio },
            ],
          },
        ],
      });

      const transcribedText = response.text.trim();
      logger.info('Audio transcription completed. Characters:', transcribedText.length);

      return transcribedText;
    } catch (error) {
      logger.error('Failed to transcribe audio:', error);
      throw new Error(`Speech transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        cause: error,
      });
    }
  }
}
