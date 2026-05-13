import { useEffect } from 'react';
import { migrateLegacyRawKey, usePersistedState } from './persisted.js';

export type Theme = 'light' | 'dark';

migrateLegacyRawKey('c4s:theme', 'c4s:shell:theme', (raw) =>
  raw === 'light' || raw === 'dark' ? raw : undefined,
);
migrateLegacyRawKey('c4s:sidebarW', 'c4s:shell:sidebar-width', (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
});
migrateLegacyRawKey('c4s:chatW', 'c4s:shell:chat-overlay-width', (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
});

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = usePersistedState<Theme>('c4s:shell:theme', systemTheme(), 1);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return [theme, setTheme];
}

const WIDTH_KEYS = {
  sidebar: 'c4s:shell:sidebar-width',
  chat: 'c4s:shell:chat-overlay-width',
} as const;

export function usePersistedWidth(
  key: keyof typeof WIDTH_KEYS,
  fallback: number,
): [number, (n: number) => void] {
  return usePersistedState<number>(WIDTH_KEYS[key], fallback, 1);
}
