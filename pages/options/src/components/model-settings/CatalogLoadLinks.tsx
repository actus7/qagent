import { useState } from 'react';
import { t } from '@extension/i18n';
import { Button } from '@extension/ui';
import { getModelCatalogErrorMessage } from './modelCatalog';
import type { CatalogProviderEntry } from './types';

interface CatalogLoadLinksProps {
  providers: CatalogProviderEntry[];
  /** Resolves with the number of models stored. */
  onLoad: (providerId: string) => Promise<number>;
}

/** One "load models" action per provider that has no models yet, shown in the agent model picker. */
export function CatalogLoadLinks({ providers, onLoad }: CatalogLoadLinksProps) {
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (providers.length === 0) {
    return null;
  }

  const handleLoad = async (providerId: string) => {
    setBusyProviderId(providerId);
    setMessage(null);
    try {
      const count = await onLoad(providerId);
      if (count === 0) {
        setMessage(t('options_models_catalog_errors_empty'));
      }
    } catch (error) {
      setMessage(getModelCatalogErrorMessage(error));
    } finally {
      setBusyProviderId(null);
    }
  };

  return (
    <div className="space-y-1">
      {providers.map(provider => (
        <Button
          key={provider.id}
          variant="ghost"
          disabled={busyProviderId !== null}
          onClick={() => void handleLoad(provider.id)}>
          {busyProviderId === provider.id
            ? t('options_models_catalog_loading')
            : t('options_models_catalog_loadFor', [provider.name])}
        </Button>
      ))}
      {message && (
        <p role="status" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
