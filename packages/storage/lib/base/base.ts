import type { BaseStorage, StorageConfig, ValueOrUpdate } from './types';
import { SessionAccessLevelEnum, StorageEnum } from './enums';

/**
 * Chrome reference error while running `processTailwindFeatures` in tailwindcss.
 *  To avoid this, we need to check if the globalThis.chrome is available and add fallback logic.
 */
const chrome = globalThis.chrome;

/**
 * If one session storage needs access from content scripts, we need to enable it globally.
 * @default false
 */
let globalSessionAccessLevelFlag: StorageConfig['sessionAccessForContentScripts'] = false;

/**
 * Checks if the storage permission is granted in the manifest.json.
 */
function checkStoragePermission(storageEnum: StorageEnum): void {
  if (!chrome) {
    return;
  }

  if (chrome.storage[storageEnum] === undefined) {
    throw new Error(`Check your storage permission in manifest.json: ${storageEnum} is not defined`);
  }
}

/**
 * Creates a storage area for persisting and exchanging data.
 */
export function createStorage<D = string>(key: string, fallback: D, config?: StorageConfig<D>): BaseStorage<D> {
  let cache: D | null = null;
  let listeners: Array<() => void> = [];
  // Writes run one at a time: each one starts after the previous write has stored its value.
  let writeQueue: Promise<void> = Promise.resolve();

  const storageEnum = config?.storageEnum ?? StorageEnum.Local;
  const liveUpdate = config?.liveUpdate ?? false;

  const serialize = config?.serialization?.serialize ?? ((v: D) => v);
  const deserialize = config?.serialization?.deserialize ?? (v => v as D);

  // Set global session storage access level for StoryType.Session, only when not already done but needed.
  if (
    globalSessionAccessLevelFlag === false &&
    storageEnum === StorageEnum.Session &&
    config?.sessionAccessForContentScripts === true
  ) {
    checkStoragePermission(storageEnum);
    chrome?.storage[storageEnum]
      .setAccessLevel({
        accessLevel: SessionAccessLevelEnum.ExtensionPagesAndContentScripts,
      })
      .catch(error => {
        console.warn(error);
        console.warn('Please call setAccessLevel into different context, like a background script.');
      });
    globalSessionAccessLevelFlag = true;
  }

  // Register life cycle methods
  const get = async (): Promise<D> => {
    checkStoragePermission(storageEnum);
    const value = await chrome?.storage[storageEnum].get([key]);

    if (!value) {
      return fallback;
    }

    return deserialize(value[key] as string) ?? fallback;
  };

  const _emitChange = () => {
    listeners.forEach(listener => listener());
  };

  const applyWrite = async (valueOrUpdate: ValueOrUpdate<D>) => {
    // An update reads the stored value, not the cache: a context without liveUpdate may be behind other writers.
    cache =
      typeof valueOrUpdate === 'function'
        ? await (valueOrUpdate as (prev: D) => Promise<D> | D)(await get())
        : valueOrUpdate;

    await chrome?.storage[storageEnum].set({ [key]: serialize(cache) });
    _emitChange();
  };

  const set = (valueOrUpdate: ValueOrUpdate<D>): Promise<void> => {
    const write = writeQueue.then(() => applyWrite(valueOrUpdate));
    // A failed write must not block the writes queued after it.
    writeQueue = write.catch(() => undefined);
    return write;
  };

  const subscribe = (listener: () => void) => {
    listeners = [...listeners, listener];

    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  };

  const getSnapshot = () => {
    return cache;
  };

  get().then(data => {
    // A write that finished before this read must not be replaced by the older stored value.
    if (cache === null) cache = data;
    _emitChange();
  });

  // Listener for live updates from the browser
  function _updateFromStorageOnChanged(changes: { [key: string]: chrome.storage.StorageChange }) {
    // Check if the key we are listening for is in the changes object
    if (changes[key] === undefined) return;

    const next: D = deserialize(changes[key].newValue as string);

    if (cache === next) return;
    // our own set() already updated the cache and notified; re-emitting would render every subscriber twice
    if (cache !== null && JSON.stringify(changes[key].newValue) === JSON.stringify(serialize(cache))) return;

    cache = next;
    _emitChange();
  }

  // Register listener for live updates for our storage area
  if (liveUpdate) {
    chrome?.storage[storageEnum].onChanged.addListener(_updateFromStorageOnChanged);
  }

  return {
    get,
    set,
    getSnapshot,
    subscribe,
  };
}
