import { t } from '@extension/i18n';
import { ProviderTypeEnum, getDefaultDisplayNameFromProviderId } from '@extension/storage';
import { Button } from '@extension/ui';
import type { ProviderSettings } from './useProviderSettings';

const MENU_ITEM_CLASS =
  'flex w-full items-center px-4 py-3 text-left text-sm text-primary transition-colors duration-150 hover:bg-muted hover:text-primary';

/** "+ Add provider" button and its dropdown of provider types. */
export function AddProviderMenu({ settings }: { settings: ProviderSettings }) {
  const { providersFromStorage, modifiedProviders, isProviderSelectorOpen } = settings;

  // Azure can be added several times; every other built-in type only once
  const selectableTypes = Object.values(ProviderTypeEnum).filter(
    type =>
      type === ProviderTypeEnum.AzureOpenAI ||
      (type !== ProviderTypeEnum.CustomOpenAI && !providersFromStorage.has(type) && !modifiedProviders.has(type)),
  );

  return (
    <div data-provider-selector-container className="relative pt-4">
      <Button
        size="compact"
        variant="secondary"
        onClick={() => settings.toggleProviderSelector()}
        className="flex w-full items-center justify-center border-border bg-muted font-medium text-primary hover:bg-muted">
        <span className="mr-2 text-sm">+</span> <span className="text-sm">{t('options_models_addNewProvider')}</span>
      </Button>

      {isProviderSelectorOpen && (
        <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-md border border-border bg-card shadow-xl">
          <div className="py-1">
            {selectableTypes.map(type => (
              <button
                key={type}
                type="button"
                className={MENU_ITEM_CLASS}
                onClick={() => settings.handleProviderSelection(type)}>
                <span className="font-medium">{getDefaultDisplayNameFromProviderId(type)}</span>
              </button>
            ))}

            <button
              type="button"
              className={MENU_ITEM_CLASS}
              onClick={() => settings.handleProviderSelection(ProviderTypeEnum.CustomOpenAI)}>
              <span className="font-medium">{t('options_models_providers_openaiCompatible')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
