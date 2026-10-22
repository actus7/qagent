import { useState, useEffect, useCallback } from 'react';
import { firewallStore, type FirewallConfig } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

export const FirewallSettings = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [activeList, setActiveList] = useState<'allow' | 'deny'>('allow');

  const applyFirewallConfig = useCallback((settings: FirewallConfig) => {
    setIsEnabled(settings.enabled);
    setAllowList(settings.allowList);
    setDenyList(settings.denyList);
  }, []);

  const loadFirewallSettings = useCallback(async () => {
    const settings = await firewallStore.getFirewall();
    applyFirewallConfig(settings);
  }, [applyFirewallConfig]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const settings = await firewallStore.getFirewall();
        if (!active) {
          return;
        }
        applyFirewallConfig(settings);
      } catch (error) {
        console.error('Failed to load firewall settings:', error);
      }
    };

    const unsubscribe = firewallStore.subscribe(() => {
      if (!active) {
        return;
      }
      const snapshot = firewallStore.getSnapshot();
      if (!snapshot) {
        return;
      }
      applyFirewallConfig(snapshot);
    });

    void load();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyFirewallConfig]);

  const handleToggleFirewall = async () => {
    const nextEnabled = !isEnabled;
    setIsEnabled(nextEnabled);

    try {
      await firewallStore.updateFirewall({ enabled: nextEnabled });
    } catch (error) {
      console.error('Failed to toggle firewall:', error);
      await loadFirewallSettings();
    }
  };

  const handleAddUrl = async () => {
    // Remove http:// or https:// prefixes
    const cleanUrl = newUrl.trim().replace(/^https?:\/\//, '');
    if (!cleanUrl) return;

    if (activeList === 'allow') {
      await firewallStore.addToAllowList(cleanUrl);
    } else {
      await firewallStore.addToDenyList(cleanUrl);
    }
    setNewUrl('');
  };

  const handleRemoveUrl = async (url: string, listType: 'allow' | 'deny') => {
    if (listType === 'allow') {
      await firewallStore.removeFromAllowList(url);
    } else {
      await firewallStore.removeFromDenyList(url);
    }
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border border-border bg-card p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold text-foreground`}>
          {t('options_firewall_header')}
        </h2>

        <div className="space-y-6">
          <div
            className={`my-6 rounded-lg border border-border bg-card p-4`}>
            <div className="flex items-center justify-between">
              <label
                htmlFor="toggle-firewall"
                className={`text-base font-medium text-foreground`}>
                {t('options_firewall_enableToggle')}
              </label>
              <div className="relative inline-block w-12 select-none">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={handleToggleFirewall}
                  className="sr-only"
                  id="toggle-firewall"
                />
                <label
                  htmlFor="toggle-firewall"
                  className={`block h-6 cursor-pointer overflow-hidden rounded-full ${isEnabled ? 'bg-primary' : 'bg-input'
                    }`}>
                  <span className="sr-only">{t('options_firewall_toggleFirewall_a11y')}</span>
                  <span
                    className={`block size-6 rounded-full bg-card shadow transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="mb-6 mt-10 flex items-center justify-between">
            <div className="flex space-x-2">
              <Button
                onClick={() => setActiveList('allow')}
                className={`px-4 py-2 text-base ${activeList === 'allow'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground'
                  }`}>
                {t('options_firewall_allowList_header')}
              </Button>
              <Button
                onClick={() => setActiveList('deny')}
                className={`px-4 py-2 text-base ${activeList === 'deny'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground'
                  }`}>
                {t('options_firewall_denyList_header')}
              </Button>
            </div>
          </div>

          <div className="mb-4 flex space-x-2">
            <input
              id="url-input"
              type="text"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleAddUrl();
                }
              }}
              placeholder={t('options_firewall_placeholders_domainUrl')}
              className={`flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground`}
            />
            <Button
              onClick={handleAddUrl}
              className={`bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90`}>
              {t('options_firewall_btnAdd')}
            </Button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {activeList === 'allow' ? (
              allowList.length > 0 ? (
                <ul className="space-y-2">
                  {allowList.map(url => (
                    <li
                      key={url}
                      className={`flex items-center justify-between rounded-md bg-muted p-2 pr-0`}>
                      <span className={`text-sm text-foreground`}>{url}</span>
                      <Button
                        onClick={() => handleRemoveUrl(url, 'allow')}
                        className={`rounded-l-none bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:opacity-90`}>
                        {t('options_firewall_btnRemove')}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`text-center text-sm text-muted-foreground`}>
                  {t('options_firewall_allowList_empty')}
                </p>
              )
            ) : denyList.length > 0 ? (
              <ul className="space-y-2">
                {denyList.map(url => (
                  <li
                    key={url}
                    className={`flex items-center justify-between rounded-md bg-muted p-2 pr-0`}>
                    <span className={`text-sm text-foreground`}>{url}</span>
                    <Button
                      onClick={() => handleRemoveUrl(url, 'deny')}
                      className={`rounded-l-none bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:opacity-90`}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-center text-sm text-muted-foreground`}>
                {t('options_firewall_denyList_empty')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        className={`rounded-lg border border-border bg-card p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold text-foreground`}>
          {t('options_firewall_howItWorks_header')}
        </h2>
        <ul className={`list-disc space-y-2 pl-5 text-left text-sm text-muted-foreground`}>
          {t('options_firewall_howItWorks')
            .split('\n')
            .map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
        </ul>
      </div>
    </section>
  );
};
