const SUPPORTED_LOCALES = ['en', 'pt_BR', 'zh_TW'];

function resolveLocale(language) {
  if (typeof language === 'string' && language !== 'auto') {
    const normalizedLanguage = language.replace('-', '_');
    if (SUPPORTED_LOCALES.includes(normalizedLanguage)) {
      return normalizedLanguage;
    }
  }

  const browserLocale = Intl.DateTimeFormat().resolvedOptions().locale.replace('-', '_');
  if (SUPPORTED_LOCALES.includes(browserLocale)) {
    return browserLocale;
  }

  const browserLang = browserLocale.split('_')[0];
  if (browserLang === 'pt') return 'pt_BR';
  if (browserLang === 'zh') return 'zh_TW';
  return 'en';
}

function replacePlaceholders(message, substitutions) {
  if (!substitutions) {
    return message.replace(/\$\d+/g, '');
  }
  if (Array.isArray(substitutions)) {
    return substitutions.reduce((acc, cur, idx) => acc.replace(`$${idx + 1}`, cur), message).replace(/\$\d+/g, '');
  }
  return message.replace(/\$(\d+)/, substitutions).replace(/\$\d+/g, '');
}

async function loadMessages() {
  try {
    const storage = await chrome.storage.local.get(['general-settings']);
    const language = storage?.['general-settings']?.language ?? 'auto';
    const locale = resolveLocale(language);
    const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
    if (!response.ok) {
      throw new Error(`Failed to load locale file for ${locale}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to load custom locale file, falling back to chrome.i18n:', error);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const localeMessages = await loadMessages();
  const getMessage = (key, substitutions) => {
    const message = localeMessages?.[key]?.message;
    if (typeof message === 'string') {
      return replacePlaceholders(message, substitutions);
    }
    return chrome.i18n.getMessage(key, substitutions);
  };

  // Set up i18n text content
  document.getElementById('title').textContent = getMessage('permissions_microphone_title');
  document.getElementById('description').textContent = getMessage('permissions_microphone_description');

  const requestButton = document.getElementById('requestPermission');
  const statusText = document.getElementById('status');

  requestButton.textContent = getMessage('permissions_microphone_grantButton');

  requestButton.addEventListener('click', async () => {
    try {
      statusText.textContent = getMessage('permissions_microphone_requesting');
      statusText.className = '';

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Permission granted - stop the tracks immediately
      stream.getTracks().forEach(track => track.stop());

      // Update UI
      statusText.textContent = getMessage('permissions_microphone_grantedSuccess');
      statusText.className = 'success';
      requestButton.textContent = getMessage('permissions_microphone_grantedButton');
      requestButton.disabled = true;

      // Close window after a short delay
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      console.error('Permission denied or error:', error);

      let errorMessage = getMessage('permissions_microphone_denied');

      if (error.name === 'NotAllowedError') {
        errorMessage += getMessage('permissions_microphone_allowHelp');
      } else if (error.name === 'NotFoundError') {
        errorMessage += getMessage('permissions_microphone_notFound');
      } else {
        errorMessage += error.message;
      }

      statusText.textContent = '❌ ' + errorMessage;
      statusText.className = 'error';
    }
  });

  // Check if permission is already granted
  navigator.permissions
    .query({ name: 'microphone' })
    .then(permissionStatus => {
      if (permissionStatus.state === 'granted') {
        statusText.textContent = getMessage('permissions_microphone_alreadyGranted');
        statusText.className = 'success';
        requestButton.textContent = getMessage('permissions_microphone_alreadyGrantedButton');
        requestButton.disabled = true;
      }
    })
    .catch(err => {
      console.log('Permission query not supported:', err);
    });
});
