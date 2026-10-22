import { t } from '@extension/i18n';
import { SECTION_CARD_CLASS } from './constants';
import { AddProviderMenu } from './AddProviderMenu';
import { ProviderCard } from './ProviderCard';
import type { ProviderSettings } from './useProviderSettings';

/** "LLM Providers" card: the list of configured providers plus the add menu. */
export function ProviderSection({ settings }: { settings: ProviderSettings }) {
  const { sortedProviders, providers } = settings;
  const providerIds = Object.keys(providers);

  return (
    <div className={SECTION_CARD_CLASS}>
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t('options_models_providers_header')}</h2>
      <div className="space-y-6">
        {sortedProviders.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="mb-4">{t('options_models_providers_notConfigured')}</p>
          </div>
        ) : (
          sortedProviders.map(([providerId, config]) => (
            <ProviderCard
              key={providerId}
              providerId={providerId}
              config={config}
              showDivider={providerIds.indexOf(providerId) < providerIds.length - 1}
              settings={settings}
            />
          ))
        )}

        <AddProviderMenu settings={settings} />
      </div>
    </div>
  );
}
