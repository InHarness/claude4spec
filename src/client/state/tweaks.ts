import { migrateLegacyRawKey, usePersistedState } from './persisted.js';

// M26 §7 — the theme preference moved to a shared zustand store (`themeStore`)
// so that unrelated surfaces (shell, Appearance section, mermaid diagram
// loader) observe the SAME `effectiveTheme`. Re-exported here because existing
// call sites import it from `state/tweaks.js`.
export { useTheme, useThemeStore, type Theme, type EffectiveTheme } from './themeStore.js';

migrateLegacyRawKey('c4s:sidebarW', 'c4s:shell:sidebar-width', (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
});
migrateLegacyRawKey('c4s:chatW', 'c4s:shell:chat-overlay-width', (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
});

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
