type StorageAreaName = 'local' | 'sync' | 'managed' | 'session';

type StorageData = Record<string, unknown>;
type StorageChangeMap = Record<string, chrome.storage.StorageChange>;
type StorageListener = (changes: StorageChangeMap, areaName: StorageAreaName) => void;

type StorageArea = {
  get: (keys?: string[] | string | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  clear: () => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
  setAccessLevel: (options: { accessLevel: string }) => Promise<void>;
  onChanged: {
    addListener: (listener: StorageListener) => void;
    removeListener: (listener: StorageListener) => void;
  };
};

type ChromeStorageMock = {
  storage: {
    local: StorageArea;
    sync: StorageArea;
    managed: StorageArea;
    session: StorageArea;
  };
};

export type ChromeStorageMockController = {
  storageData: Record<StorageAreaName, StorageData>;
  listenerCounts: Record<StorageAreaName, () => number>;
};

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeKeys(keys?: string[] | string | null): string[] | null {
  if (keys === null || keys === undefined) {
    return null;
  }
  if (Array.isArray(keys)) {
    return keys;
  }
  return [keys];
}

export function installChromeStorageMock(): ChromeStorageMockController {
  const storageData: Record<StorageAreaName, StorageData> = {
    local: {},
    sync: {},
    managed: {},
    session: {},
  };

  const storageListeners: Record<StorageAreaName, Set<StorageListener>> = {
    local: new Set<StorageListener>(),
    sync: new Set<StorageListener>(),
    managed: new Set<StorageListener>(),
    session: new Set<StorageListener>(),
  };

  const emitChanges = (area: StorageAreaName, changes: StorageChangeMap) => {
    for (const listener of storageListeners[area]) {
      listener(changes, area);
    }
  };

  const createStorageArea = (area: StorageAreaName): StorageArea => {
    return {
      get: async keys => {
        const normalizedKeys = normalizeKeys(keys);
        if (normalizedKeys === null) {
          return cloneValue(storageData[area]);
        }

        const response: Record<string, unknown> = {};
        for (const key of normalizedKeys) {
          if (Object.prototype.hasOwnProperty.call(storageData[area], key)) {
            response[key] = cloneValue(storageData[area][key]);
          }
        }
        return response;
      },
      set: async items => {
        const changes: StorageChangeMap = {};

        for (const [key, value] of Object.entries(items)) {
          changes[key] = {
            oldValue: cloneValue(storageData[area][key]),
            newValue: cloneValue(value),
          };
          storageData[area][key] = cloneValue(value);
        }

        emitChanges(area, changes);
      },
      clear: async () => {
        const changes: StorageChangeMap = {};
        for (const [key, value] of Object.entries(storageData[area])) {
          changes[key] = { oldValue: cloneValue(value), newValue: undefined };
        }
        storageData[area] = {};
        emitChanges(area, changes);
      },
      remove: async keys => {
        const keysToRemove = Array.isArray(keys) ? keys : [keys];
        const changes: StorageChangeMap = {};

        for (const key of keysToRemove) {
          if (Object.prototype.hasOwnProperty.call(storageData[area], key)) {
            changes[key] = {
              oldValue: cloneValue(storageData[area][key]),
              newValue: undefined,
            };
            delete storageData[area][key];
          }
        }

        if (Object.keys(changes).length > 0) {
          emitChanges(area, changes);
        }
      },
      setAccessLevel: async () => undefined,
      onChanged: {
        addListener: listener => {
          storageListeners[area].add(listener);
        },
        removeListener: listener => {
          storageListeners[area].delete(listener);
        },
      },
    };
  };

  const chromeStorageMock: ChromeStorageMock = {
    storage: {
      local: createStorageArea('local'),
      sync: createStorageArea('sync'),
      managed: createStorageArea('managed'),
      session: createStorageArea('session'),
    },
  };

  Object.defineProperty(globalThis, 'chrome', {
    value: chromeStorageMock,
    writable: true,
    configurable: true,
  });

  return {
    storageData,
    listenerCounts: {
      local: () => storageListeners.local.size,
      sync: () => storageListeners.sync.size,
      managed: () => storageListeners.managed.size,
      session: () => storageListeners.session.size,
    },
  };
}
