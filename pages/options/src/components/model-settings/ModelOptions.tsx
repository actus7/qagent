import { toModelValue } from './modelUtils';
import type { AvailableModel } from './types';

/** <option> list for a set of available "provider > model" entries. */
export function ModelOptions({ models }: { models: AvailableModel[] }) {
  return (
    <>
      {models.map(({ provider, providerName, model }) => (
        <option key={toModelValue(provider, model)} value={toModelValue(provider, model)}>
          {`${providerName} > ${model}`}
        </option>
      ))}
    </>
  );
}
