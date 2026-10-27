import { Actors, chatHistoryStore, computeNextRunAt, scheduledTasksStore } from '@extension/storage';
import type { ScheduledTask, ScheduleRun, ScheduleRunOutcome } from '@extension/storage';
import type { SidePanelTaskCommand } from '@extension/shared';
import { ExecutionState } from '../../agent/event/types';
import { createLogger } from '../../log';
import { prepareManagedTask } from '../managedPolicy';
import { isAssistantTaskRunning, runAssistantTask } from '../../task/taskRunner';
import { decideScheduledRun } from './decision';
import { syncScheduleAlarms } from './alarms';

const logger = createLogger('background');
const TAB_LOAD_TIMEOUT_MS = 30_000;

/** Side effects of a scheduled run, injectable so the orchestration can be tested without Chrome. */
export interface ScheduleRunDeps {
  getTask: (id: string) => Promise<ScheduledTask | undefined>;
  saveTask: (task: ScheduledTask) => Promise<void>;
  appendRun: (id: string, run: ScheduleRun) => Promise<void>;
  isBusy: () => boolean;
  /** Creates the chat session that holds the run and stores the prompt as its first user message. */
  createSession: (title: string, prompt: string) => Promise<string>;
  openStartTab: (url: string) => Promise<number>;
  /** Runs the task through the side panel's pipeline and resolves with the terminal state, or null. */
  startTask: (command: SidePanelTaskCommand) => Promise<string | null>;
  syncAlarms: () => Promise<void>;
  now: () => number;
}

/** Maps a terminal execution state to a run outcome. Pauses and missing states count as cancelled. */
export function outcomeForState(state: string | null): { outcome: ScheduleRunOutcome; detail: string } {
  if (state === ExecutionState.TASK_OK) return { outcome: 'completed', detail: 'concluída' };
  if (state === ExecutionState.TASK_FAIL) return { outcome: 'failed', detail: 'falhou' };
  return { outcome: 'cancelled', detail: 'cancelada' };
}

/** Runs one schedule now. Skipped and blocked runs are recorded and the schedule still advances. */
export async function runScheduledTaskWith(id: string, deps: ScheduleRunDeps): Promise<void> {
  const task = await deps.getTask(id);
  const decision = decideScheduledRun({ task, busy: deps.isBusy() });
  if (!task || decision.action === 'ignore') return;

  if (decision.action !== 'run') {
    const outcome: ScheduleRunOutcome = decision.action === 'skip' ? 'skipped' : 'blocked';
    await finishRun(task, { at: deps.now(), outcome, sessionId: null, detail: decision.detail }, deps);
    return;
  }

  let sessionId: string | null = null;
  let run: ScheduleRun;
  try {
    sessionId = await deps.createSession(task.name, task.prompt);
    const tabIds: number[] = [];
    let tabId = 0;
    if (task.startUrl) {
      tabId = await deps.openStartTab(task.startUrl);
      tabIds.push(tabId);
    }
    const state = await deps.startTask({
      task: task.prompt,
      taskId: sessionId,
      tabId,
      options: { mode: task.mode, tabIds },
    });
    const { outcome, detail } = outcomeForState(state);
    run = { at: deps.now(), outcome, sessionId, detail };
  } catch (error) {
    logger.error(`Scheduled task ${id} failed to run:`, error);
    const detail = error instanceof Error ? error.message : 'erro desconhecido';
    run = { at: deps.now(), outcome: 'failed', sessionId, detail };
  }
  // Outside the try: a storage error while recording a finished run must not be recorded again as a failure.
  await finishRun(task, run, deps);
}

async function finishRun(task: ScheduledTask, run: ScheduleRun, deps: ScheduleRunDeps): Promise<void> {
  await deps.appendRun(task.id, run);
  const latest = (await deps.getTask(task.id)) ?? task;
  // A one-time schedule is done after its first attempt; recurring ones move to the next occurrence after now.
  const isOnce = latest.frequency === 'once';
  await deps.saveTask({
    ...latest,
    enabled: isOnce ? false : latest.enabled,
    nextRunAt: isOnce ? null : computeNextRunAt(latest, deps.now()),
  });
  await deps.syncAlarms();
}

async function waitForTabLoad(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;
  await new Promise<void>(resolve => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (updatedId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, TAB_LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function defaultScheduleRunDeps(): ScheduleRunDeps {
  return {
    getTask: id => scheduledTasksStore.getTask(id),
    saveTask: task => scheduledTasksStore.saveTask(task),
    appendRun: (id, run) => scheduledTasksStore.appendRun(id, run),
    isBusy: () => isAssistantTaskRunning(),
    createSession: async (title, prompt) => {
      const session = await chatHistoryStore.createSession(title);
      await chatHistoryStore.addMessage(session.id, { actor: Actors.USER, content: prompt, timestamp: Date.now() });
      return session.id;
    },
    openStartTab: async url => {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error('Não foi possível abrir a aba inicial.');
      await waitForTabLoad(tab.id);
      return tab.id;
    },
    startTask: async command => {
      let finalState: string | null = null;
      // Same managed-policy gate as the side panel and MCP entry points (provider checks).
      await runAssistantTask(await prepareManagedTask(command), undefined, {
        onFinished: state => {
          finalState = state;
        },
      });
      return finalState;
    },
    syncAlarms: () => syncScheduleAlarms(),
    now: () => Date.now(),
  };
}

/** Entry point for the alarm and the "Executar agora" command. */
export async function runScheduledTask(id: string): Promise<void> {
  await runScheduledTaskWith(id, defaultScheduleRunDeps());
}
