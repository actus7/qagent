import React from 'react';
import { FiX, FiExternalLink, FiGlobe } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';
import { Card } from '@src/components/ui/card';
import type { Language } from '@src/context/LanguageContext';
import { useLanguage } from '@src/context/LanguageContext';

interface SettingsModalProps {
  chatDebugMode: boolean;
  onClose: () => void;
  onChatDebugModeChange: (enabled: boolean) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ chatDebugMode, onClose, onChatDebugModeChange }) => {
  const { language, changeLanguage } = useLanguage();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-[90%] max-w-sm overflow-hidden border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold">{t('settings_title') || 'Settings'}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="size-8">
            <FiX className="size-5" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {/* Language Setting */}
          <div className="space-y-2">
            <label htmlFor="sidepanelLanguage" className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FiGlobe className="size-4" />
              {t('settings_language') || 'Language'}
            </label>
            <select
              id="sidepanelLanguage"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={language}
              onChange={e => changeLanguage(e.target.value as Language)}>
              <option value="auto">{t('settings_language_auto') || 'Auto (Browser Default)'}</option>
              <option value="en">English</option>
              <option value="pt_BR">Português (Brasil)</option>
              <option value="zh_TW">繁體中文</option>
            </select>
          </div>

          {/* Debug mode */}
          <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
            <div className="pr-3">
              <p className="text-sm font-medium text-foreground">{t('settings_debugMode') || 'Debug Mode'}</p>
              <p className="text-xs text-muted-foreground">
                {t('settings_debugMode_desc') || 'Show all execution events in chat.'}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="chatDebugMode"
                type="checkbox"
                checked={chatDebugMode}
                onChange={e => onChatDebugModeChange(e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="chatDebugMode"
                className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring"
              >
                <span className="sr-only">{t('settings_debugMode') || 'Debug Mode'}</span>
              </label>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <Button variant="outline" className="w-full justify-between" onClick={() => chrome.runtime.openOptionsPage()}>
              {t('settings_advanced') || 'Advanced Settings'}
              <FiExternalLink className="size-4" />
            </Button>
          </div>

          <div className="text-center text-xs text-muted-foreground">
            {t('settings_version')} {chrome.runtime.getManifest().version}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SettingsModal;
