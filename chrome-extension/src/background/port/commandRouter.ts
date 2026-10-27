import { llmProviderStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { SidePanelCommandMessage, SidePanelResponseMessage } from '@extension/shared';
import { DEFAULT_AGENT_OPTIONS } from '../agent/types';
import { createLogger } from '../log';
import { loadAssistantModel } from '../services/assistant-model';
import { compactChatConversation } from '../services/conversation-compaction';
import { assertManagedProvidersAllowed, loadManagedPolicy, prepareManagedTask } from '../services/managedPolicy';
import { SpeechToTextService } from '../services/speechToText';
import { workflowRecorder } from '../services/workflowRecording';
import { saveRecordedWorkflow } from '../workflows/build';
import { captureVisibleTab } from '../services/tabCapture';
import { browserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
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
      await runAssistantTask(await prepareManagedTask(message));
      break;
    }

    case 'follow_up_task': {
      await runAssistantTask(await prepareManagedTask(message));
      break;
    }

    case 'cancel_task': {
      await cancelActiveTask();
      break;
    }

    case 'compact_chat': {
      const model = await loadAssistantModel(message.modelAgent);
      const compacted = await compactChatConversation(message.taskId, model);
      return post({ type: 'conversation_compacted', taskId: message.taskId, compacted });
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

    case 'answer_question': {
      // Without a waiting ask_user action the answer is dropped; the panel only offers it while one waits.
      const { currentExecutor } = runtimeStore.getState();
      currentExecutor?.answerQuestion(message.text.trim());
      return post({ type: 'success' });
    }

    case 'screenshot': {
      const page = await browserContext.switchTab(message.tabId);
      const screenshot = await page.takeScreenshot();
      logger.info('screenshot captured', { tabId: message.tabId, size: screenshot?.length ?? 0 });
      return post({ type: 'success', screenshot });
    }

    case 'capture_visible_tab': {
      const dataUrl = await captureVisibleTab(message.tabId);
      return post({ type: 'tab_capture', dataUrl });
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
      await assertManagedProvidersAllowed(await loadManagedPolicy());
      await runAssistantTask(message, message.historySessionId);
      break;
    }

    case 'workflow_record_start': {
      const result = await workflowRecorder.start(message.tabId);
      if (!result.ok) {
        return post({
          type: 'error',
          error: t(result.reason === 'already_recording' ? 'bg_record_alreadyRecording' : 'bg_record_unsupportedTab'),
        });
      }
      break;
    }

    case 'workflow_record_stop': {
      await workflowRecorder.stop();
      break;
    }

    case 'workflow_record_discard': {
      await workflowRecorder.discard();
      break;
    }

    case 'workflow_record_build': {
      try {
        const snapshot = await workflowRecorder.snapshot();
        await saveRecordedWorkflow(message.name, snapshot.steps, 'navigator');
        return post({ type: 'success' });
      } catch (error) {
        logger.error('Could not build the recorded workflow', error);
        return post({ type: 'error', error: t('bg_record_buildFailed') });
      }
    }

    case 'workflow_record_status': {
      return post({ type: 'workflow_recording', snapshot: await workflowRecorder.snapshot() });
    }
  }
}
