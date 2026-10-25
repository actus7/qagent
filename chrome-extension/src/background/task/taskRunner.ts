import { t } from '@extension/i18n';
import { describeModelError } from '../agent/agents/errors';
import { chatHistoryStore } from '@extension/storage';
import type { ExecutionPortEventMessage, SidePanelTaskCommand } from '@extension/shared';
import type { Executor } from '../agent/executor';
import { ExecutionState } from '../agent/event/types';
import { buildTaskMemory, composeFollowUpTask, type TaskMemoryOutcome } from '../agent/task-memory';
import { createLogger } from '../log';
import ScopedBrowserContext from '../browser/scoped-context';
import { postToPanel } from '../port/panelPort';
import { loadConversationContext, streamBrowserAnswer } from '../services/browser-assistant';
import { compactIfNeeded } from '../services/conversation-compaction';
import { attentionEventForState, notifyTaskAttention } from '../services/task-notifications';
import { loadAssistantModel } from '../services/assistant-model';
import { buildFileAttachmentNote } from '../services/assistant-attachments';
import { browserContext, isAgentBrowserContext } from '../state/browserSession';
import { runtimeStore } from '../state/runtimeStore';
import { startAgentBrowserStream, stopAgentBrowserStream, syncAgentBrowserToTabUrl } from './agentBrowserControl';
import { subscribeToExecutorEvents } from './executorEvents';
import { clearRunningTask, saveRunningTask, startServiceWorkerKeepAlive, updateRunningTaskSteps } from './runState';
import { setupExecutor } from './setupExecutor';
import { taskTabGroups } from '../services/tab-groups';
import { runCliAgentTask, selectedCliRunner } from '../services/mcpBridge/cliTask';

// The single in-flight assistant task. Only this module reads or writes it.
let activeTask: AbortController | null = null;
const logger = createLogger('background');

const TASK_OUTCOMES: Record<string, TaskMemoryOutcome | undefined> = {
  [ExecutionState.TASK_OK]: 'completed',
  [ExecutionState.TASK_FAIL]: 'failed',
  [ExecutionState.TASK_CANCEL]: 'cancelled',
  [ExecutionState.TASK_PAUSE]: 'paused',
};

// Each act task runs in a fresh executor, so the next follow-up gets what this run did from the stored memory.
async function rememberTask(
  sessionId: string,
  task: string,
  executor: Executor,
  terminalEvent: ExecutionPortEventMessage | null,
  tabId: number,
): Promise<void> {
  const outcome = terminalEvent ? TASK_OUTCOMES[terminalEvent.state] : undefined;
  if (!outcome) return;
  try {
    const url = await chrome.tabs.get(tabId).then(
      tab => tab.url ?? null,
      () => null,
    );
    const run = executor.getRunMemory();
    await chatHistoryStore.setTaskMemory(
      sessionId,
      buildTaskMemory({ task, outcome, finalAnswer: run.finalAnswer, url, actions: run.actions }),
    );
  } catch (error) {
    // A failed memory write must not change the outcome the user already sees
    logger.error('Failed to save the task memory for follow-ups:', error);
  }
}

export async function cancelActiveTask(): Promise<void> {
  activeTask?.abort();
  await runtimeStore.getState().currentExecutor?.cancel();
}

export function isAssistantTaskRunning(): boolean {
  return activeTask !== null;
}

export interface AssistantTaskHooks {
  /** Called once the task has ended, with its terminal state (null when no terminal state was emitted). */
  onFinished?: (state: string | null) => void;
}

export async function runAssistantTask(
  message: SidePanelTaskCommand,
  replaySessionId?: string,
  hooks: AssistantTaskHooks = {},
): Promise<void> {
  if (activeTask) throw new Error(t('bg_task_busy'));
  const controller = new AbortController();
  activeTask = controller;
  const stopKeepAlive = startServiceWorkerKeepAlive();
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
      const model = await loadAssistantModel(options.modelAgent);
      // Compaction is best effort: when it fails the budgeted history is still sent.
      await compactIfNeeded(message.taskId, model)
        .then(compacted => {
          if (compacted) postToPanel({ type: 'conversation_compacted', taskId: message.taskId, compacted });
        })
        .catch(error => logger.error('Automatic compaction failed; sending the trimmed history instead:', error));
      await streamBrowserAnswer({
        taskId: message.taskId,
        task: message.task,
        tabIds,
        mode,
        attachments: message.attachments,
        model,
        signal: controller.signal,
        post: postToPanel,
      });
      emit(controller.signal.aborted ? ExecutionState.TASK_CANCEL : ExecutionState.TASK_OK);
      return;
    }
    if (tabIds.length === 0) throw new Error(t('bg_task_selectTab'));
    const cliRunner = await selectedCliRunner();
    if (cliRunner) {
      // The CLI agent is chosen in options: the daemon runs it and its steps reach the panel as they happen.
      emit(ExecutionState.TASK_START);
      const tabId = tabIds.includes(message.tabId) ? message.tabId : tabIds[0];
      const outcome = await runCliAgentTask({
        taskId: message.taskId,
        task: message.task,
        tabId,
        runner: cliRunner,
        signal: controller.signal,
        post: postToPanel,
      });
      if (controller.signal.aborted) emit(ExecutionState.TASK_CANCEL, t('bg_task_interrupted'));
      else if (outcome.ok) emit(ExecutionState.TASK_OK, outcome.text);
      else emit(ExecutionState.TASK_FAIL, outcome.error ?? '');
      return;
    }
    if (browserContext instanceof ScopedBrowserContext) browserContext.setAllowedTabs(tabIds);
    await taskTabGroups.start(message.taskId, tabIds);
    await saveRunningTask({
      taskId: message.taskId,
      task: message.task,
      mode,
      tabIds,
      stepCount: 0,
      status: 'running',
      startedAt: Date.now(),
    });
    const { summary, messages: history } = await loadConversationContext(message.taskId);
    // The request being sent is already the last chat message; it is passed as the current task below.
    const previous = history
      .slice(0, -1)
      .slice(-10)
      .map(item => `${item.role === 'user' ? 'human' : 'ai'}: ${item.content}`);
    const conversation = [summary ? `summary of earlier messages: ${summary}` : '', ...previous]
      .filter(Boolean)
      .join('\n');
    const memory = await chatHistoryStore.getTaskMemory(message.taskId).catch(error => {
      logger.error('Failed to read the task memory for follow-ups:', error);
      return null;
    });
    const currentTask = [message.task, buildFileAttachmentNote(message.attachments)].filter(Boolean).join('\n\n');
    const task = composeFollowUpTask({ memory, history: conversation, currentTask });
    executor = await setupExecutor(message.taskId, task, browserContext, options, message.attachments);
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
    subscribeToExecutorEvents(
      executor,
      event => {
        terminalEvent = event;
      },
      step => {
        updateRunningTaskSteps(step).catch(error => logger.error('Failed to save the running task step:', error));
      },
    );
    if (replaySessionId) await executor.replayHistory(replaySessionId);
    else await executor.execute();
  } catch (error) {
    if (controller.signal.aborted) emit(ExecutionState.TASK_CANCEL, t('bg_task_interrupted'));
    else emit(ExecutionState.TASK_FAIL, describeModelError(error, t));
  } finally {
    stopKeepAlive();
    if (mode === 'act') await clearRunningTask();
    await taskTabGroups.finish(message.taskId);
    if (executor) {
      const tabId = tabIds.includes(message.tabId) ? message.tabId : tabIds[0];
      await rememberTask(message.taskId, message.task, executor, terminalEvent, tabId);
      await executor.cleanup();
    } else if (mode === 'act') await browserContext.cleanup();
    if (isAgentBrowserContext(browserContext)) await stopAgentBrowserStream(message.taskId);
    runtimeStore.getState().setExecutor(null);
    runtimeStore.getState().resetOverlay();
    if (activeTask === controller) activeTask = null;
    // Assigned from the event callback, which TypeScript cannot see here; the cast restores the declared type.
    const finalEvent = terminalEvent as ExecutionPortEventMessage | null;
    hooks.onFinished?.(finalEvent?.state ?? null);
    if (finalEvent) {
      const attention = attentionEventForState(finalEvent.state);
      if (attention) void notifyTaskAttention(attention, finalEvent.data.details);
      postToPanel(finalEvent);
    }
  }
}
