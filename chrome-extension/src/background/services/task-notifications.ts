import { generalSettingsStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { ExecutionState } from '../agent/event/types';
import { createLogger } from '../log';
import { runtimeStore } from '../state/runtimeStore';

const logger = createLogger('background');
const NOTIFICATION_ICON = 'icon-128.png';
const MAX_BODY_CHARS = 160;

export type TaskAttentionEvent = 'completed' | 'failed';

export interface NotificationDecision {
  enabled: boolean;
  panelConnected: boolean;
  event: TaskAttentionEvent | null;
}

/**
 * Notify only when the setting is on, the event needs the user, and no side panel is connected to show it.
 * ponytail: a connected but hidden panel counts as shown; Chrome gives no visibility signal to the worker.
 */
export function shouldNotify({ enabled, panelConnected, event }: NotificationDecision): boolean {
  return enabled && !panelConnected && event !== null;
}

/** Maps a terminal execution state to the event the user should hear about. Cancels and pauses are user-driven. */
export function attentionEventForState(state: string): TaskAttentionEvent | null {
  if (state === ExecutionState.TASK_OK) return 'completed';
  if (state === ExecutionState.TASK_FAIL) return 'failed';
  return null;
}

const TITLE_KEYS = {
  completed: 'bg_notify_completedTitle',
  failed: 'bg_notify_failedTitle',
} as const satisfies Record<TaskAttentionEvent, string>;

export async function notifyTaskAttention(event: TaskAttentionEvent, details: string): Promise<void> {
  try {
    const { notifyOnCompletion } = await generalSettingsStore.getSettings();
    const panelConnected = Boolean(runtimeStore.getState().currentPort);
    if (!shouldNotify({ enabled: notifyOnCompletion, panelConnected, event })) return;

    const body = details.trim().slice(0, MAX_BODY_CHARS) || t('bg_notify_fallbackBody');
    chrome.notifications.create(`qagent-task-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
      title: t(TITLE_KEYS[event]),
      message: body,
    });
  } catch (error) {
    // A failed notification must never change the task outcome
    logger.error('Failed to show the task notification:', error);
  }
}

/** Clicking a notification focuses the last window and asks Chrome to open the side panel there. */
export function registerTaskNotificationClicks(): void {
  chrome.notifications.onClicked.addListener(notificationId => {
    void (async () => {
      chrome.notifications.clear(notificationId);
      const window = await chrome.windows.getLastFocused();
      if (window.id === undefined) return;
      await chrome.windows.update(window.id, { focused: true });
      // Chrome may refuse opening the panel without a user gesture; the window is still focused then.
      await chrome.sidePanel.open({ windowId: window.id }).catch(() => undefined);
    })().catch(error => logger.error('Failed to handle the notification click:', error));
  });
}
