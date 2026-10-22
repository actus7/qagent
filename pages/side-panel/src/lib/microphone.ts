import { t } from '@extension/i18n';

export const MAX_RECORDING_MS = 2 * 60 * 1000;

const PERMISSION_CHECK_DELAY_MS = 500;

/** Opens the extension permission page in a popup and runs `onClosed` shortly after it closes. */
export const openMicrophonePermissionWindow = (onClosed: () => void) => {
  const permissionUrl = chrome.runtime.getURL('permission/index.html');

  chrome.windows.create(
    {
      url: permissionUrl,
      type: 'popup',
      width: 500,
      height: 600,
    },
    createdWindow => {
      if (!createdWindow?.id) return;
      chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
        if (windowId !== createdWindow.id) return;
        chrome.windows.onRemoved.removeListener(onWindowClose);
        setTimeout(onClosed, PERMISSION_CHECK_DELAY_MS);
      });
    },
  );
};

export const describeMicrophoneError = (error: unknown): string => {
  let message = t('chat_stt_microphone_accessFailed');
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') {
      message += t('chat_stt_microphone_grantPermission');
    } else if (error.name === 'NotFoundError') {
      message += t('chat_stt_microphone_notFound');
    } else {
      message += error.message;
    }
  }
  return message;
};
