import { llmProviderStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { SidePanelCommandMessage, SidePanelResponseMessage } from '@extension/shared';
import { DEFAULT_AGENT_OPTIONS } from '../agent/types';
import { createLogger } from '../log';
import { SpeechToTextService } from '../services/speechToText';
import { browserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
import { actionApprovals } from '../task/actionApprovals';
import { forwardBrowserInput } from '../task/agentBrowserControl';
import { cancelActiveTask, runAssistantTask } from '../task/taskRunner';

const logger = createLogger('background');

export type PostPortMessage = (payload: SidePanelResponseMessage) => void;

// Routes one validated side-panel command. Errors thrown here are reported by the caller.
export async function routeSidePanelCommand(message: SidePanelCommandMessage, post: PostPortMessage): Promise<void> {
  switch (message.type) {
    case 'heartbeat':
      // Acknowledge heartbeat
      post({ type: 'heartbeat_ack' });
      break;

    case 'new_task': {
      await runAssistantTask(message);
      break;
    }

    case 'follow_up_task': {
      await runAssistantTask(message);
      break;
    }

    case 'cancel_task': {
      await cancelActiveTask();
      break;
    }

    case 'approval_result': {
      actionApprovals.resolve(message.taskId, message.requestId, message.approved, message.decision);
      break;
    }

    case 'resume_task': {
      // No executor means chat/plan mode or a finished task: answer success so the panel keeps its state
      const { currentExecutor } = runtimeStore.getState();
      await currentExecutor?.resume();
      return post({ type: 'success' });
    }

    case 'pause_task': {
      const { currentExecutor } = runtimeStore.getState();
      await currentExecutor?.pause();
      return post({ type: 'success' });
    }

    case 'screenshot': {
      const page = await browserContext.switchTab(message.tabId);
      const screenshot = await page.takeScreenshot();
      logger.info('screenshot', message.tabId, screenshot);
      return post({ type: 'success', screenshot });
    }

    case 'state': {
      try {
        const browserState = await browserContext.getState(true);
        const elementsText = browserState.elementTree.clickableElementsToString(
          DEFAULT_AGENT_OPTIONS.includeAttributes,
        );

        logger.info('state', browserState);
        logger.info('interactive elements', elementsText);
        return post({ type: 'success', msg: t('bg_cmd_state_printed') });
      } catch (error) {
        logger.error('Failed to get state:', error);
        return post({ type: 'error', error: t('bg_cmd_state_failed') });
      }
    }

    case 'nohighlight': {
      const page = await browserContext.getCurrentPage();
      await page.removeHighlight();
      return post({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
    }

    case 'speech_to_text': {
      try {
        logger.info('Processing speech-to-text request...');

        // Get all providers for speech-to-text service
        const providers = await llmProviderStore.getAllProviders();

        // Create speech-to-text service with all providers
        const speechToTextService = await SpeechToTextService.create(providers);

        // Extract base64 audio data (remove data URL prefix if present)
        let base64Audio = message.audio;
        if (base64Audio.startsWith('data:')) {
          base64Audio = base64Audio.split(',')[1];
        }

        // Transcribe audio
        const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

        logger.info('Speech-to-text completed successfully');
        return post({
          type: 'speech_to_text_result',
          text: transcribedText,
        });
      } catch (error) {
        logger.error('Speech-to-text failed:', error);
        return post({
          type: 'speech_to_text_error',
          error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
        });
      }
    }

    case 'browser_input': {
      try {
        await forwardBrowserInput(message.input, message.sessionId);
        return post({ type: 'success' });
      } catch (error) {
        return post({
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to forward browser input',
        });
      }
    }

    case 'replay': {
      await runAssistantTask(message, message.historySessionId);
      break;
    }
  }
}
