import { useState } from 'react';
import { t } from '@extension/i18n';
import { normalizeModelIds } from '@extension/shared';
import { Button } from '@extension/ui';
import { PANEL_CLASS, TEXT_INPUT_CLASS } from './constants';
import { getModelCatalogErrorMessage } from './modelCatalog';
import type { CatalogState } from './useProviderModelCatalog';

interface ModelCatalogPickerProps {
  id: string;
  catalog: CatalogState;
  /** Models already saved for the provider. They stay listed and start checked. */
  currentModels: string[];
  onRetry: () => void;
  onConfirm: (modelNames: string[]) => void;
  onCancel: () => void;
}

/** Searchable checklist of the models a provider returns. Confirming replaces the provider's modelNames. */
export function ModelCatalogPicker({
  id,
  catalog,
  currentModels,
  onRetry,
  onConfirm,
  onCancel,
}: ModelCatalogPickerProps) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentModels));

  const catalogModels = catalog.status === 'ready' ? catalog.models : [];
  const allModels = normalizeModelIds([...catalogModels, ...currentModels]);
  const term = filter.trim().toLowerCase();
  const visibleModels = allModels.filter(model => model.toLowerCase().includes(term));
  const allVisibleSelected = visibleModels.length > 0 && visibleModels.every(model => selected.has(model));

  const toggleModel = (model: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  };

  const toggleVisibleModels = () => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const model of visibleModels) {
        if (allVisibleSelected) {
          next.delete(model);
        } else {
          next.add(model);
        }
      }
      return next;
    });
  };

  return (
    <div id={id} className={`${PANEL_CLASS} space-y-3`}>
      {catalog.status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('options_models_catalog_loading')}
        </p>
      )}

      {catalog.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{getModelCatalogErrorMessage(catalog.error)}</span>
          <Button variant="ghost" onClick={onRetry}>
            {t('options_models_catalog_retry')}
          </Button>
        </div>
      )}

      {catalog.status === 'ready' && allModels.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('options_models_catalog_errors_empty')}</p>
      )}

      {allModels.length > 0 && (
        <>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('options_models_catalog_filterPlaceholder')}
            aria-label={t('options_models_catalog_filterPlaceholder')}
            className={`w-full ${TEXT_INPUT_CLASS}`}
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleModels} />
              {t('options_models_catalog_selectAllFiltered')}
            </label>
            <span>{t('options_models_catalog_selectedCount', [String(selected.size)])}</span>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border border-input bg-card p-1">
            {visibleModels.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">{t('options_models_catalog_noMatches')}</p>
            ) : (
              visibleModels.map(model => (
                <label
                  key={model}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-foreground hover:bg-muted">
                  <input type="checkbox" checked={selected.has(model)} onChange={() => toggleModel(model)} />
                  <span className="truncate font-mono text-xs">{model}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('options_models_catalog_cancel')}
        </Button>
        <Button disabled={selected.size === 0} onClick={() => onConfirm(normalizeModelIds([...selected]))}>
          {t('options_models_catalog_confirm')}
        </Button>
      </div>
    </div>
  );
}
