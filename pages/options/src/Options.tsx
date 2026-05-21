import { lazy, Suspense, useState } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { useTheme, withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiSettings, FiCpu, FiShield } from 'react-icons/fi';
import { useLanguage } from './context/LanguageContext';

type TabTypes = 'general' | 'models' | 'firewall';

const GeneralSettingsTab = lazy(async () => {
  const module = await import('./components/GeneralSettings');
  return { default: module.GeneralSettings };
});

const ModelSettingsTab = lazy(async () => {
  const module = await import('./components/ModelSettings');
  return { default: module.ModelSettings };
});

const FirewallSettingsTab = lazy(async () => {
  const module = await import('./components/FirewallSettings');
  return { default: module.FirewallSettings };
});

const Options = () => {
  const { currentLocale } = useLanguage();
  const { resolvedTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<TabTypes>('models');
  const isDarkMode = resolvedTheme === 'dark';
  const tabs: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
    { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
    { id: 'firewall', icon: FiShield, label: t('options_tabs_firewall') },
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
      case 'firewall':
        return <FirewallSettingsTab />;
      default:
        return null;
    }
  };

  return (
    <div
      data-locale={currentLocale}
      className={`flex min-h-screen min-w-[768px] ${isDarkMode ? 'bg-slate-900' : "bg-[url('/bg.jpg')] bg-cover bg-center"} ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
      {/* Vertical Navigation Bar */}
      <nav
        className={`w-48 border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-white/20 bg-[#10b981]/10'} backdrop-blur-sm`}>
        <div className="p-4">
          <h1 className={`mb-6 text-xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_nav_header')}
          </h1>
          <ul className="space-y-2">
            {tabs.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base 
                    ${activeTab !== item.id
                      ? `${isDarkMode ? 'bg-slate-700/70 text-gray-300 hover:text-white' : 'bg-emerald-500/15 font-medium text-gray-700 hover:text-white'} backdrop-blur-sm`
                      : `${isDarkMode ? 'bg-emerald-800/50' : ''} text-white backdrop-blur-sm`
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
      <main className={`flex-1 ${isDarkMode ? 'bg-slate-800/50' : 'bg-white/10'} p-8 backdrop-blur-sm`}>
        <div className="mx-auto min-w-[512px] max-w-screen-lg">
          <Suspense fallback={<div>Loading...</div>}>{renderTabContent()}</Suspense>
        </div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
