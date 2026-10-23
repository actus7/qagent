import { t } from '@extension/i18n';
import type { ProviderConfig } from '@extension/storage';
import { Button } from '@extension/ui';
import { getProviderActionState } from './providerUtils';
import { ProviderFormFields } from './ProviderFormFields';
import type { ProviderSettings } from './useProviderSettings';

interface ProviderCardProps {
  providerId: string;
  config: ProviderConfig;
  showDivider: boolean;
  settings: ProviderSettings;
}

/** One provider entry: header with save/delete (and cancel for unsaved ones), then its fields. */
export function ProviderCard({ providerId, config, showDivider, settings }: ProviderCardProps) {
  const { modifiedProviders, providersFromStorage } = settings;
  const isInStorage = providersFromStorage.has(providerId);
  const isModified = modifiedProviders.has(providerId);
  const isNewProvider = isModified && !isInStorage;
  const actionState = getProviderActionState(config, isInStorage, isModified);
  const saveError = settings.saveErrors[providerId];

  return (
    <div
      id={`provider-${providerId}`}
      className={`space-y-4 ${isNewProvider ? 'rounded-lg border border-border bg-muted p-4' : ''}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-foreground">{config.name || providerId}</h3>
        <div className="flex space-x-2">
          {isModified && (
            <Button variant="secondary" onClick={() => void settings.handleCancelProvider(providerId)}>
              {t('options_models_providers_btnCancel')}
            </Button>
          )}
          <Button
            variant={actionState.variant}
            disabled={actionState.disabled}
            onClick={() =>
              actionState.isDelete ? settings.handleDelete(providerId) : settings.handleSave(providerId)
            }>
            {actionState.label}
          </Button>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}

      {isNewProvider && (
        <div className="mb-2 text-sm text-primary">
          <p>{t('options_models_providers_setupInstructions')}</p>
        </div>
      )}

      <ProviderFormFields providerId={providerId} config={config} isNewProvider={isNewProvider} settings={settings} />

      {showDivider && <div className="mt-4 border-t border-border" />}
    </div>
  );
}
