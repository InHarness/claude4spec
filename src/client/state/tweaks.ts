import { useEffect, useState } from 'react';
import { migrateLegacyRawKey, usePersistedState } from './persisted.js';

export type Theme = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

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

/**
 * M26 §7 — one-shot migration of the theme preference from the legacy
 * shell-namespaced key to the new settings-namespaced key. The legacy value
 * was a `{v:1, data:'light'|'dark'}` envelope, NOT a raw string, so the
 * generic `migrateLegacyRawKey` helper does not fit. We promote the legacy
 * value forward (interpreting it as `Theme`, which is a superset) and delete
 * the old key. Runs only when `c4s:settings:theme` is not yet present.
 */
function migrateLegacyThemeEnvelope(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem('c4s:settings:theme') !== null) return;
    const legacy = window.localStorage.getItem('c4s:shell:theme');
    if (!legacy) return;
    const parsed = JSON.parse(legacy) as { v?: unknown; data?: unknown };
    if (parsed?.data === 'light' || parsed?.data === 'dark' || parsed?.data === 'system') {
      const env = { v: 1, data: parsed.data as Theme };
      window.localStorage.setItem('c4s:settings:theme', JSON.stringify(env));
    }
    window.localStorage.removeItem('c4s:shell:theme');
  } catch {
    /* malformed legacy envelope — drop it and fall through to default */
  }
}
migrateLegacyThemeEnvelope();

function prefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(theme: Theme): EffectiveTheme {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/**
 * M26 §7 — three-state theme preference with live `prefers-color-scheme`
 * subscription. The hook resolves `theme === 'system'` to an `effectiveTheme`
 * (`light` | `dark`) and toggles the `.dark` class on `<html>` whenever it
 * changes. When `theme === 'system'`, we listen to OS-level changes and update
 * the class in place — no reload required.
 *
 * Persistence: `c4s:settings:theme` envelope `{v:1, data:<Theme>}`. The
 * anti-FOUC inline script in `index.html` mirrors this resolution
 * synchronously before React mounts.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  effectiveTheme: EffectiveTheme;
} {
  const [theme, setTheme] = usePersistedState<Theme>('c4s:settings:theme', 'system', 1);
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(() => resolveTheme(theme));

  useEffect(() => {
    setEffectiveTheme(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark');
  }, [effectiveTheme]);

  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setEffectiveTheme(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  return { theme, setTheme, effectiveTheme };
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
