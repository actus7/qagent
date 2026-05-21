import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
type SystemTheme = 'light' | 'dark';

interface ThemeSnapshot {
  theme: Theme;
  systemTheme: SystemTheme;
}

const STORAGE_KEY = 'qagent-theme';
const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];
const subscribers = new Set<(snapshot: ThemeSnapshot) => void>();
let snapshot: ThemeSnapshot | null = null;
let listenersInitialized = false;

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme(): SystemTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : 'system';
}

function getSnapshot(): ThemeSnapshot {
  if (!snapshot) {
    snapshot = {
      theme: readStoredTheme(),
      systemTheme: getSystemTheme(),
    };
  }
  return snapshot;
}

function persistTheme(theme: Theme) {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

function notify() {
  const current = getSnapshot();
  subscribers.forEach(listener => listener(current));
}

function applyTheme(resolved: SystemTheme) {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function resolveTheme(current: ThemeSnapshot): SystemTheme {
  return current.theme === 'system' ? current.systemTheme : current.theme;
}

function setThemeValue(theme: Theme) {
  const current = getSnapshot();
  if (current.theme === theme) {
    return;
  }
  snapshot = { ...current, theme };
  persistTheme(theme);
  notify();
}

function ensureGlobalListeners() {
  if (listenersInitialized || typeof window === 'undefined') {
    return;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const nextTheme = isTheme(event.newValue) ? event.newValue : 'system';
    const current = getSnapshot();
    if (current.theme === nextTheme) {
      return;
    }
    snapshot = { ...current, theme: nextTheme };
    notify();
  };

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemChange = () => {
    const nextSystemTheme = getSystemTheme();
    const current = getSnapshot();
    if (current.systemTheme === nextSystemTheme) {
      return;
    }
    snapshot = { ...current, systemTheme: nextSystemTheme };
    notify();
  };

  window.addEventListener('storage', handleStorage);
  mediaQuery.addEventListener('change', handleSystemChange);
  listenersInitialized = true;
}

export function useTheme() {
  const [state, setState] = useState<ThemeSnapshot>(() => getSnapshot());

  useEffect(() => {
    ensureGlobalListeners();
    subscribers.add(setState);
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const resolvedTheme = resolveTheme(state);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeValue(newTheme);
  }, []);

  const cycleTheme = useCallback(() => {
    const currentTheme = getSnapshot().theme;
    const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme) + 1) % THEME_ORDER.length];
    setThemeValue(nextTheme);
  }, []);

  return { theme: state.theme, resolvedTheme, setTheme, cycleTheme };
}
