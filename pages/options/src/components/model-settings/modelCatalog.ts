import { t } from '@extension/i18n';
import { ProviderModelsError } from '@extension/shared';

/** User-facing text for a failed model catalog request. Details stay out of the UI. */
export function getModelCatalogErrorMessage(error: unknown): string {
  if (!(error instanceof ProviderModelsError)) {
    return t('options_models_catalog_errors_unknown');
  }
  switch (error.code) {
    case 'missingBaseUrl':
      return t('options_models_catalog_errors_missingBaseUrl');
    case 'invalidBaseUrl':
      return t('options_models_catalog_errors_invalidBaseUrl');
    case 'unauthorized':
      return t('options_models_catalog_errors_unauthorized');
    case 'http':
      return t('options_models_catalog_errors_http', [String(error.status ?? '')]);
    case 'network':
      return t('options_models_catalog_errors_network');
    case 'timeout':
      return t('options_models_catalog_errors_timeout');
    case 'invalidResponse':
      return t('options_models_catalog_errors_invalidResponse');
    case 'unsupported':
      return t('options_models_catalog_errors_unsupported');
  }
}
