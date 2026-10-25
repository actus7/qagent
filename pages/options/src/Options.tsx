import { lazy, Suspense, useState } from 'react';
import { Button } from '@extension/ui';
import { useTheme, withErrorBoundary, withSuspense, useLanguage } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiSettings, FiCpu, FiClock, FiTool } from 'react-icons/fi';

type TabTypes = 'general' | 'models' | 'schedules' | 'plugins';

const GeneralSettingsTab = lazy(async () => {
  const module = await import('./components/GeneralSettings');
  return { default: module.GeneralSettings };
});

const ModelSettingsTab = lazy(async () => {
  const module = await import('./components/model-settings/ModelSettings');
  return { default: module.ModelSettings };
});

const ScheduledTasksTab = lazy(async () => {
  const module = await import('./components/ScheduledTasksSettings');
  return { default: module.ScheduledTasksSettings };
});

const BrowserPluginsTab = lazy(async () => {
  const module = await import('./components/BrowserPluginsSettings');
  return { default: module.BrowserPluginsSettings };
});

const Options = () => {
  const { currentLocale } = useLanguage();
  // Applies the `.dark` class to <html>; the token CSS and every component read from it.
  useTheme();
  const [activeTab, setActiveTab] = useState<TabTypes>('models');
  const tabs: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
    { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
    { id: 'schedules', icon: FiClock, label: t('options_tabs_schedules') },
    { id: 'plugins', icon: FiTool, label: t('options_tabs_plugins') },
  ];

  const handleTabClick = (tabId: TabTypes) => {
    setActiveTab(tabId);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettingsTab />;
      case 'models':
        return <ModelSettingsTab />;
      case 'schedules':
        return <ScheduledTasksTab />;
      case 'plugins':
        return <BrowserPluginsTab />;
      default:
        return null;
    }
  };

  return (
    <div data-locale={currentLocale} className="flex min-h-screen min-w-3xl bg-background text-foreground">
      {/* Vertical Navigation Bar */}
      <nav className="w-48 border-r border-border bg-card">
        <div className="p-4">
          <h1 className="mb-6 text-xl font-bold text-foreground">{t('options_nav_header')}</h1>
          <ul className="space-y-2">
            {tabs.map(item => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base ${
                    activeTab === item.id
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}>
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-8">
        <div className="mx-auto max-w-(--breakpoint-lg) min-w-lg">
          <Suspense fallback={<div>{t('options_common_loading')}</div>}>{renderTabContent()}</Suspense>
        </div>
      </main>
    </div>
  );
};

export default withErrorBoundary(
  withSuspense(Options, <div>{t('options_common_loading')}</div>),
  <div>{t('options_common_errorOccurred')}</div>,
);
