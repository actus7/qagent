import { FiSettings, FiSun, FiMoon, FiMonitor } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import type { Theme } from '@extension/shared';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';

interface AssistantHeaderProps {
  showHistory: boolean;
  showStopButton: boolean;
  theme: Theme;
  onCycleTheme: () => void;
  onBackToChat: () => void;
  onNewChat: () => void;
  onLoadHistory: () => void;
  onOpenSettings: () => void;
}

const ThemeIcon = ({ theme }: { theme: Theme }) => {
  const Icon = theme === 'dark' ? FiMoon : theme === 'light' ? FiSun : FiMonitor;
  return <Icon size={17} />;
};

export default function AssistantHeader({
  showHistory,
  showStopButton,
  theme,
  onCycleTheme,
  onBackToChat,
  onNewChat,
  onLoadHistory,
  onOpenSettings,
}: AssistantHeaderProps) {
  return (
    <header className="assistant-header">
      <div className="assistant-brand">
        <span className="assistant-brand-mark">Q</span>
        <span>QAgent</span>
        <span className="assistant-brand-caption">BROWSER</span>
      </div>
      <div className="assistant-header-actions">
        {showHistory ? (
          <Button className="assistant-header-back" variant="ghost" size="sm" onClick={onBackToChat}>
            {t('nav_back')}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              disabled={showStopButton}
              onClick={onNewChat}
              aria-label={t('nav_newChat_a11y')}
              title={t('nav_newChat_a11y')}>
              <PiPlusBold size={17} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={showStopButton}
              onClick={onLoadHistory}
              aria-label={t('nav_loadHistory_a11y')}
              title={t('nav_loadHistory_a11y')}>
              <GrHistory size={16} />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onCycleTheme}
          aria-label={t('nav_theme_a11y', [theme])}
          title={t('nav_theme_a11y', [theme])}>
          <ThemeIcon theme={theme} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label={t('nav_settings_a11y')}
          title={t('nav_settings_a11y')}>
          <FiSettings size={17} />
        </Button>
      </div>
    </header>
  );
}
