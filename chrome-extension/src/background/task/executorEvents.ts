import { Actors as ChatActors, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { ExecutionPortEventMessage, SidePanelResponseMessage } from '@extension/shared';
import type { Executor } from '../agent/executor';
import { ExecutionState } from '../agent/event/types';
import { createLogger } from '../log';
import { applyOverlayMode, sendOverlayMessage } from '../overlay/overlayMessaging';
import { postToPanel } from '../port/panelPort';
import { taskTabGroups } from '../services/tab-groups';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');

export function subscribeToExecutorEvents(
  executor: Executor,
  onTerminal: (event: ExecutionPortEventMessage) => void,
  onStep?: (step: number) => void,
) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Reset overlay status for new task
  runtimeStore.getState().setOverlayStatusText(null);

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    if (onStep && event.data.step > 0) onStep(event.data.step);
    if (event.state === ExecutionState.TASK_OK && event.data.details && event.data.details !== event.data.taskId) {
      const streamId = crypto.randomUUID();
      // A failed history write must not swallow the completion: the terminal event below still has to reach the panel.
      await chatHistoryStore
        .addMessage(event.data.taskId, {
          actor: ChatActors.ASSISTANT,
          content: event.data.details,
          timestamp: event.timestamp,
          streamId,
          kind: 'answer',
        })
        .catch(error => logger.error('Failed to save the final answer to chat history:', error));
      postToPanel({
        type: 'assistant_delta',
        taskId: event.data.taskId,
        streamId,
        content: event.data.details,
        finished: true,
      });
    }
    try {
      const { currentPort } = runtimeStore.getState();
      if (currentPort) {
        const executionMessage: SidePanelResponseMessage = {
          type: 'execution',
          actor: event.actor,
          state: event.state,
          data: event.data,
          timestamp: event.timestamp,
        };
        if ([ExecutionState.TASK_OK, ExecutionState.TASK_FAIL, ExecutionState.TASK_CANCEL].includes(event.state)) {
          onTerminal(executionMessage);
        } else currentPort.postMessage(executionMessage);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    // Forward relevant events to the content script overlay only for chrome debugger mode.
    if (!isAgentBrowserContext(browserContext)) {
      const tabId = browserContext.currentTabId;

      switch (event.state) {
        case ExecutionState.TASK_START:
          runtimeStore.getState().setOverlayStatusText(t('sidepanel_progress_message'));
          runtimeStore.getState().setOverlayVisible(true);
          sendOverlayMessage(tabId, { type: 'qagent:overlay:show' });
          sendOverlayMessage(tabId, {
            type: 'qagent:overlay:status',
            text: t('sidepanel_progress_message'),
          });
          break;
        case ExecutionState.TASK_OK:
        case ExecutionState.TASK_FAIL:
        case ExecutionState.TASK_CANCEL:
          runtimeStore.getState().resetOverlay();
          sendOverlayMessage(tabId, { type: 'qagent:overlay:hide' });
          break;
        case ExecutionState.ACT_START: {
          const statusText = event.data?.details || 'Working…';
          runtimeStore.getState().setOverlayStatusText(statusText);
          sendOverlayMessage(tabId, {
            type: 'qagent:overlay:status',
            text: statusText,
          });
          // Tabs the task opened since the last step join the task's tab group.
          void browserContext
            .getAllTabIds()
            .then(tabIds => taskTabGroups.sync(event.data.taskId, [...tabIds]))
            .catch(error => logger.warning('Tab group sync skipped', error));
          break;
        }
        case ExecutionState.TASK_PAUSE:
          applyOverlayMode(tabId, 'paused');
          break;
        case ExecutionState.TASK_RESUME:
          applyOverlayMode(tabId, 'running');
          break;
      }
    }
  });
}
