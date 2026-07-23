import { create } from 'zustand';
import { migrateLegacyRawKey } from './persisted.js';

export type Theme = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

const KEY = 'c4s:settings:theme';
const VERSION = 1;

migrateLegacyRawKey('c4s:theme', 'c4s:shell:theme', (raw) =>
  raw === 'light' || raw === 'dark' ? raw : undefined,
);

/**
 * M26 §7 — one-shot migration of the theme preference from the legacy
 * shell-namespaced key to the new settings-namespaced key. The legacy value
 * was a `{v:1, data:'light'|'dark'}` envelope, NOT a raw string, so the
 * generic `migrateLegacyRawKey` helper does not fit. We promote the legacy
 * value forward (interpreting it as `Theme`, which is a superset) and delete
 * the old key. Runs only when `c4s:settings:theme` is not yet present.
 *
 * Both migrations run at module load, BEFORE the store hydrates below — the
 * chain is legacy raw → `c4s:shell:theme` → `c4s:settings:theme`, so order
 * matters.
 */
function migrateLegacyThemeEnvelope(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(KEY) !== null) return;
    const legacy = window.localStorage.getItem('c4s:shell:theme');
    if (!legacy) return;
    const parsed = JSON.parse(legacy) as { v?: unknown; data?: unknown };
    if (parsed?.data === 'light' || parsed?.data === 'dark' || parsed?.data === 'system') {
      const env = { v: VERSION, data: parsed.data as Theme };
      window.localStorage.setItem(KEY, JSON.stringify(env));
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

/** Reads the `{v:1, data}` envelope written by `usePersistedState`. */
function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return 'system';
    const env = JSON.parse(raw) as { v?: unknown; data?: unknown };
    if (env?.v !== VERSION) return 'system';
    if (env.data === 'light' || env.data === 'dark' || env.data === 'system') return env.data;
    return 'system';
  } catch {
    return 'system';
  }
}

function persistTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: VERSION, data: theme }));
  } catch {
    /* quota or unavailable */
  }
}

interface ThemeState {
  theme: Theme;
  effectiveTheme: EffectiveTheme;
  setTheme(next: Theme): void;
}

/**
 * M26 §7 — three-state theme preference as a SHARED store.
 *
 * It has to be a store rather than per-component `useState`: several unrelated
 * surfaces now observe `effectiveTheme` (the shell, the Appearance section, and
 * — since 0.1.141 — the mermaid diagram loader, which must re-`initialize()`
 * and re-render on every switch). With `usePersistedState` each consumer held
 * its own copy, so a change made in Settings was invisible to the others.
 *
 * Persistence: `c4s:settings:theme` envelope `{v:1, data:<Theme>}` — the same
 * shape `usePersistedState` writes, and the same key the anti-FOUC inline
 * script in `index.html` reads before React mounts.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  effectiveTheme: resolveTheme(readStoredTheme()),
  setTheme: (next) => {
    if (get().theme === next) return;
    persistTheme(next);
    set({ theme: next, effectiveTheme: resolveTheme(next) });
  },
}));

if (typeof window !== 'undefined') {
  // `system` follows the OS in place — no reload required.
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', (e) => {
    if (useThemeStore.getState().theme !== 'system') return;
    useThemeStore.setState({ effectiveTheme: e.matches ? 'dark' : 'light' });
  });

  const applyClass = (effective: EffectiveTheme) => {
    document.documentElement.classList.toggle('dark', effective === 'dark');
  };
  applyClass(useThemeStore.getState().effectiveTheme);
  useThemeStore.subscribe((state, prev) => {
    if (state.effectiveTheme !== prev.effectiveTheme) applyClass(state.effectiveTheme);
  });
}

/**
 * Thin selector over {@link useThemeStore}, kept for the call sites that read
 * the theme as a hook. Mounting it has no side-effects of its own — the
 * `prefers-color-scheme` subscription and the `.dark` class toggle live at
 * module scope above, so they run exactly once regardless of how many
 * components subscribe.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  effectiveTheme: EffectiveTheme;
} {
  const theme = useThemeStore((s) => s.theme);
  const effectiveTheme = useThemeStore((s) => s.effectiveTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return { theme, setTheme, effectiveTheme };
}
