import { useState, useEffect, useCallback } from 'react';
import { sitePermissionsStore } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

export const SitePermissionsSettings = () => {
  const [origins, setOrigins] = useState<string[]>([]);

  const loadOrigins = useCallback(async () => {
    try {
      setOrigins(await sitePermissionsStore.getAllowedOrigins());
    } catch (error) {
      console.error('Failed to load allowed sites:', error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const allowed = await sitePermissionsStore.getAllowedOrigins();
        if (active) setOrigins(allowed);
      } catch (error) {
        console.error('Failed to load allowed sites:', error);
      }
    };

    const unsubscribe = sitePermissionsStore.subscribe(() => {
      if (active) void load();
    });
    void load();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleRemove = async (origin: string) => {
    try {
      await sitePermissionsStore.removeOrigin(origin);
    } catch (error) {
      console.error('Failed to remove allowed site:', error);
      await loadOrigins();
    }
  };

  const handleRemoveAll = async () => {
    if (!window.confirm(t('options_sitePermissions_confirmRemoveAll'))) return;
    try {
      await sitePermissionsStore.clearOrigins();
    } catch (error) {
      console.error('Failed to clear allowed sites:', error);
      await loadOrigins();
    }
  };

  return (
    <section className="space-y-6">
      <div className={`rounded-lg border border-border bg-card p-6 text-left shadow-xs`}>
        <h2 className={`mb-2 text-xl font-semibold text-foreground`}>{t('options_sitePermissions_header')}</h2>
        <p className="mb-6 text-sm text-muted-foreground">{t('options_sitePermissions_description')}</p>

        {origins.length > 0 ? (
          <>
            <div className="mb-4 flex justify-end">
              <Button
                onClick={handleRemoveAll}
                className="bg-destructive px-4 py-2 text-sm text-destructive-foreground hover:opacity-90">
                {t('options_sitePermissions_btnRemoveAll')}
              </Button>
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {origins.map(origin => (
                <li key={origin} className="flex items-center justify-between rounded-md bg-muted p-2 pr-0">
                  <span className="text-sm text-foreground">{origin}</span>
                  <Button
                    onClick={() => handleRemove(origin)}
                    className="rounded-l-none bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:opacity-90">
                    {t('options_sitePermissions_btnRemove')}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-center text-sm text-muted-foreground">{t('options_sitePermissions_empty')}</p>
        )}
      </div>
    </section>
  );
};
