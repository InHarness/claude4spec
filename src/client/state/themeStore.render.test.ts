// @vitest-environment happy-dom
/**
 * M26 `#appearance` card (ui-view `settings-page`, M26 §7): the theme lives in
 * `themeStore` + localStorage `c4s:settings:theme` (`{v:1, data}`), outside
 * `config.json`. A choice applies at once; `system` follows
 * `prefers-color-scheme` in place; after a reload the inline script in
 * `index.html` restores the `dark` class before React mounts.
 *
 * `themeStore` subscribes to `matchMedia` at module load, so every test installs
 * a controllable `matchMedia` and imports the modules afresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'c4s:settings:theme';

/** A `matchMedia('(prefers-color-scheme: dark)')` the test can flip. */
function installMatchMedia(initiallyDark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: initiallyDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: globalThis.matchMedia });
  return {
    listeners,
    setOsDark(dark: boolean) {
      mql.matches = dark;
      for (const l of listeners) l({ matches: dark });
    },
  };
}

const isDark = () => document.documentElement.classList.contains('dark');
const stored = () => window.localStorage.getItem(KEY);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

async function renderAppearance() {
  const { APPEARANCE_SETTINGS } = await import('../components/shell/AppearanceElement.js');
  const Appearance = APPEARANCE_SETTINGS.elements![0]!.component!;
  await act(async () => {
    root.render(createElement(Appearance, {} as never));
  });
}

const option = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

/** The anti-FOUC script of `index.html`, as the browser runs it before React mounts. */
function runIndexHtmlInlineScript() {
  const html = fs.readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(inline, 'index.html has an inline <script> in <head>').toBeTruthy();
  new Function(inline!)();
}

describe('Appearance — theme (M26 §7)', () => {
  it('[ac:ac-zmiana-theme-w-sekcji-appearance-natyc] changing the theme applies the dark class at once, persists {v:1,data} under c4s:settings:theme, and after a reload the index.html inline script restores the class before React mounts', async () => {
    installMatchMedia(false);
    await renderAppearance();
    expect(isDark()).toBe(false);

    // Dark: the class is on <html> right after the click — no save, no reload.
    await act(async () => {
      option('Dark').click();
    });
    expect(isDark()).toBe(true);
    expect(JSON.parse(stored()!)).toEqual({ v: 1, data: 'dark' });

    // Light: removed just as instantly.
    await act(async () => {
      option('Light').click();
    });
    expect(isDark()).toBe(false);
    expect(JSON.parse(stored()!)).toEqual({ v: 1, data: 'light' });

    // System: persisted as such.
    await act(async () => {
      option('System').click();
    });
    expect(JSON.parse(stored()!)).toEqual({ v: 1, data: 'system' });

    // Reload with `dark` stored: a fresh document (no class) gets it from the inline
    // script alone, before any React code runs.
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: 'dark' }));
    document.documentElement.classList.remove('dark');
    runIndexHtmlInlineScript();
    expect(isDark()).toBe(true);

    // …and with `light` stored it stays light.
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: 'light' }));
    document.documentElement.classList.remove('dark');
    runIndexHtmlInlineScript();
    expect(isDark()).toBe(false);
  });

  it('[ac:ac-theme-system-reaguje-na-zmiane-prefer] theme system follows a runtime prefers-color-scheme change through the themeStore matchMedia subscription, without a reload', async () => {
    const os = installMatchMedia(false);
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: 'system' }));
    const { useThemeStore } = await import('./themeStore.js');
    expect(globalThis.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(os.listeners.size).toBeGreaterThan(0);
    expect(useThemeStore.getState().theme).toBe('system');
    expect(useThemeStore.getState().effectiveTheme).toBe('light');
    expect(isDark()).toBe(false);

    await renderAppearance();
    expect(host.textContent).toContain('Currently rendering light');

    // The OS switches to dark: effectiveTheme and the <html> class follow in place.
    await act(async () => {
      os.setOsDark(true);
    });
    expect(useThemeStore.getState().effectiveTheme).toBe('dark');
    expect(isDark()).toBe(true);
    expect(host.textContent).toContain('Currently rendering dark');

    // …and back.
    await act(async () => {
      os.setOsDark(false);
    });
    expect(useThemeStore.getState().effectiveTheme).toBe('light');
    expect(isDark()).toBe(false);

    // An explicit choice is not overridden by the OS.
    await act(async () => {
      useThemeStore.getState().setTheme('light');
    });
    await act(async () => {
      os.setOsDark(true);
    });
    expect(useThemeStore.getState().effectiveTheme).toBe('light');
    expect(isDark()).toBe(false);
  });
});
