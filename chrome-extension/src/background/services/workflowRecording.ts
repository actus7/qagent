import { t } from '@extension/i18n';
import { postToPanel } from '../port/panelPort';
import { sendOverlayMessage } from '../overlay/overlayMessaging';
import { createWorkflowRecorder } from './workflowRecordingState';

const SESSION_KEY = 'workflowRecording';

// Content-script messages. Steps are validated by the recorder; the sender tab comes from the runtime, not the payload.
export const RECORDING_STEP_MESSAGE = 'qagent:recording:step';
export const RECORDING_STOP_REQUEST_MESSAGE = 'qagent:recording:stop-request';

// The service worker owns the single recorder. chrome.storage.session keeps the steps across worker restarts.
export const workflowRecorder = createWorkflowRecorder({
  load: async () => (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY],
  save: snapshot => chrome.storage.session.set({ [SESSION_KEY]: snapshot }),
  clear: () => chrome.storage.session.remove(SESSION_KEY),
  publish: snapshot => postToPanel({ type: 'workflow_recording', snapshot }),
  setCapture: (tabId, active) =>
    sendOverlayMessage(
      tabId,
      active
        ? {
            type: 'qagent:recording:start',
            text: t('chat_record_indicator_text'),
            stopText: t('chat_record_indicator_stop'),
          }
        : { type: 'qagent:recording:stop' },
    ),
  isRecordableTab: async tabId => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    return /^https?:\/\//i.test(tab?.url ?? '');
  },
});

export function registerWorkflowRecording(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id) return false;
    const tabId = sender.tab.id;
    const type = (message as { type?: unknown } | null)?.type;
    if (type === RECORDING_STEP_MESSAGE) {
      void workflowRecorder.appendStep(tabId, (message as { step?: unknown }).step);
    } else if (type === RECORDING_STOP_REQUEST_MESSAGE) {
      void workflowRecorder.stop();
    }
    return false;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void workflowRecorder.navigated(tabId, changeInfo.url);
    // A reloaded page starts with a disarmed content script; re-arm it once the page has loaded.
    if (changeInfo.status === 'complete') void workflowRecorder.rearm(tabId);
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    void workflowRecorder.tabClosed(tabId);
  });
}
