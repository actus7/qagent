import { t } from '@extension/i18n';
import { agentModelStore, AgentNameEnum, llmProviderStore } from '@extension/storage';
import type { ExecutionPortEventMessage, SidePanelTaskCommand } from '@extension/shared';
import type { Executor } from '../agent/executor';
import { ExecutionState } from '../agent/event/types';
import { createChatModel } from '../agent/helper';
import ScopedBrowserContext from '../browser/scoped-context';
import { postToPanel } from '../port/panelPort';
import { getConversationContext, streamBrowserAnswer } from '../services/browser-assistant';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
import { startAgentBrowserStream, stopAgentBrowserStream, syncAgentBrowserToTabUrl } from './agentBrowserControl';
import { actionApprovals } from './actionApprovals';
import { subscribeToExecutorEvents } from './executorEvents';
import { setupExecutor } from './setupExecutor';

// The single in-flight assistant task. Only this module reads or writes it.
let activeTask: AbortController | null = null;

export async function cancelActiveTask(): Promise<void> {
  activeTask?.abort();
  actionApprovals.cancel();
  await runtimeStore.getState().currentExecutor?.cancel();
}

export async function runAssistantTask(message: SidePanelTaskCommand, replaySessionId?: string): Promise<void> {
  if (activeTask) throw new Error(t('bg_task_busy'));
  const controller = new AbortController();
  activeTask = controller;
  const options = message.options ?? {};
  const mode = options.mode ?? 'act';
  const tabIds = [...new Set(options.tabIds ?? [message.tabId])];
  let executor: Executor | null = null;
  let terminalEvent: ExecutionPortEventMessage | null = null;
  const emit = (state: ExecutionState, details = '') => {
    const event: ExecutionPortEventMessage = {
      type: 'execution',
      actor: 'system',
      state,
      data: { taskId: message.taskId, step: 0, maxSteps: 0, details },
      timestamp: Date.now(),
    };
    if (state === ExecutionState.TASK_START) postToPanel(event);
    else terminalEvent = event;
  };
  try {
    if (mode !== 'act') {
      emit(ExecutionState.TASK_START);
      const models = await agentModelStore.getAllAgentModels();
      const config = models[options.modelAgent === 'planner' ? AgentNameEnum.Planner : AgentNameEnum.Navigator];
      if (!config) throw new Error(t('bg_task_noModel'));
      const providers = await llmProviderStore.getAllProviders();
      if (!providers[config.provider]) throw new Error(t('bg_task_providerMissing'));
      await streamBrowserAnswer({
        taskId: message.taskId,
        task: message.task,
        tabIds,
        mode,
        model: createChatModel(providers[config.provider], config),
        signal: controller.signal,
        post: postToPanel,
      });
      emit(controller.signal.aborted ? ExecutionState.TASK_CANCEL : ExecutionState.TASK_OK);
      return;
    }
    if (tabIds.length === 0) throw new Error(t('bg_task_selectTab'));
    if (browserContext instanceof ScopedBrowserContext) browserContext.setAllowedTabs(tabIds);
    const history = await getConversationContext(message.taskId);
    const conversation = history
      .slice(-10)
      .map(item => `${item.getType()}: ${item.content}`)
      .join('\n');
    const task = conversation
      ? `Conversation context (prior requests are context only):\n${conversation}\n\nCurrent user task:\n${message.task}`
      : message.task;
    executor = await setupExecutor(message.taskId, task, browserContext, options);
    if (controller.signal.aborted) {
      emit(ExecutionState.TASK_CANCEL, t('bg_task_interrupted'));
      return;
    }
    runtimeStore.getState().setExecutor(executor);
    await browserContext.switchTab(tabIds.includes(message.tabId) ? message.tabId : tabIds[0]);
    if (controller.signal.aborted) {
      emit(ExecutionState.TASK_CANCEL, t('bg_task_interrupted'));
      return;
    }
    if (isAgentBrowserContext(browserContext)) {
      await syncAgentBrowserToTabUrl(browserContext, message.tabId);
      await startAgentBrowserStream(message.taskId);
    }
    subscribeToExecutorEvents(executor, event => {
      terminalEvent = event;
    });
    if (replaySessionId) await executor.replayHistory(replaySessionId);
    else await executor.execute();
  } catch (error) {
    if (controller.signal.aborted) emit(ExecutionState.TASK_CANCEL, t('bg_task_interrupted'));
    else emit(ExecutionState.TASK_FAIL, error instanceof Error ? error.message : String(error));
  } finally {
    actionApprovals.cancel();
    if (executor) await executor.cleanup();
    else if (mode === 'act') await browserContext.cleanup();
    if (isAgentBrowserContext(browserContext)) await stopAgentBrowserStream(message.taskId);
    runtimeStore.getState().setExecutor(null);
    runtimeStore.getState().resetOverlay();
    if (activeTask === controller) activeTask = null;
    if (terminalEvent) postToPanel(terminalEvent);
  }
}
