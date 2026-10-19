// @vitest-environment happy-dom
/**
 * M34/L12 — the token bridge of `@c4s/plugin-runtime/ui`: the closed list of
 * host token names (21 colour + 15 typography + 2 layering), the one-shot
 * `readHostTokens()` and the `useHostTokens()` hook that re-reads on a theme
 * mode switch — plus the bridge-only colouring of `GroupedEntityList`.
 *
 * The real host theme stylesheet (`styles/theme.css`) is loaded into the
 * document, so every value asserted here is what the host actually paints.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as pluginRuntimeUi from '../runtime/plugin-runtime-ui.js';
import { HOST_TOKEN_NAMES, readHostTokens, type HostTokenName } from './tokens.js';
import { useHostTokens } from './useHostTokens.js';
import { GroupedEntityList, type GroupedEntityListProps } from './list/GroupedEntityList.js';

/** The catalog's one generic, pinned to `string` rows for `createElement`. */
const StringGroupedList = GroupedEntityList as unknown as FunctionComponent<GroupedEntityListProps<string>>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Resolved with node:path from the module's own file path — under happy-dom the
// global `URL` is the window's, so `new URL(rel, import.meta.url)` is not a
// `file:` URL that `fileURLToPath` accepts (same pattern as useToast.render.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS = readFileSync(resolve(HERE, '../styles/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The top-level `:root { … }` / `.dark { … }` blocks of theme.css — where the bridge tokens live. */
function themeBlocks(selector: ':root' | '.dark'): string[] {
  const re = selector === ':root' ? /(?:^|\n):root\s*\{([^}]*)\}/g : /(?:^|\n)\.dark\s*\{([^}]*)\}/g;
  return [...THEME_CSS.matchAll(re)].map((m) => m[1]!);
}
const declares = (blocks: string[], name: string) =>
  blocks.some((b) => new RegExp(`(^|[\\s;])${name.replace(/[-]/g, '\\-')}\\s*:`).test(b));

const ROOT_BLOCKS = themeBlocks(':root');
const DARK_BLOCKS = themeBlocks('.dark');

const COLOR = [
  '--c-bg', '--c-panel', '--c-card', '--c-ink', '--c-muted', '--c-subtle', '--c-hair',
  '--c-hair-strong', '--c-accent', '--c-accent-soft', '--c-accent-ink', '--c-yellow',
  '--c-yellow-ink', '--c-green', '--c-green-soft', '--c-blue', '--c-blue-soft', '--c-purple',
  '--c-purple-soft', '--c-red', '--c-red-soft',
];
const TYPOGRAPHY = [
  '--font-heading', '--font-body', '--font-mono',
  '--text-h1', '--text-h2', '--text-h3', '--text-body', '--text-lede', '--text-code',
  '--text-sm', '--text-xs', '--text-2xs',
  '--weight-heading', '--weight-body', '--weight-lede',
];
const LAYERING = ['--z-popover', '--z-toast'];

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement('style');
  style.textContent = [
    ...ROOT_BLOCKS.map((b) => `:root {${b}}`),
    ...DARK_BLOCKS.map((b) => `.dark {${b}}`),
  ].join('\n');
  document.head.appendChild(style);
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.documentElement.classList.remove('dark');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

async function setDark(on: boolean) {
  await act(async () => {
    document.documentElement.classList.toggle('dark', on);
    // Let the MutationObserver deliver and React flush the state update.
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('token bridge — closed name list (M34/L12)', () => {
  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] HOST_TOKEN_NAMES is exactly 21 colour + 15 typography + 2 layering names', () => {
    expect([...HOST_TOKEN_NAMES]).toEqual([...COLOR, ...TYPOGRAPHY, ...LAYERING]);
    expect(TYPOGRAPHY).toHaveLength(15);
    expect(HOST_TOKEN_NAMES).toHaveLength(38);
  });

  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] the bridge is exported from @c4s/plugin-runtime/ui', () => {
    expect(pluginRuntimeUi.HOST_TOKEN_NAMES).toBe(HOST_TOKEN_NAMES);
    expect(typeof pluginRuntimeUi.readHostTokens).toBe('function');
    expect(typeof pluginRuntimeUi.useHostTokens).toBe('function');
  });

  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] every bridge name is a host theme variable; colours per mode, typography and z-index mode-invariant', () => {
    for (const name of HOST_TOKEN_NAMES) expect(declares(ROOT_BLOCKS, name), name).toBe(true);
    for (const name of COLOR) expect(declares(DARK_BLOCKS, name), name).toBe(true);
    for (const name of [...TYPOGRAPHY, ...LAYERING]) expect(declares(DARK_BLOCKS, name), name).toBe(false);
  });

  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] readHostTokens resolves values identical to the c4s-paper-terra entity', () => {
    const t = readHostTokens();
    // Colour — Base mode (entity primitives paper/ink/terra).
    expect(t['--c-bg']).toBe('#faf8f4');
    expect(t['--c-card']).toBe('#fffdf8');
    expect(t['--c-ink']).toBe('#2a2722');
    expect(t['--c-hair']).toBe('#e8e2d5');
    expect(t['--c-accent']).toBe('#c45a3b');
    expect(t['--c-red-soft']).toBe('#efd4c9');
    // Typography — font-serif / font-sans / font-mono, the text-* scale, weights.
    expect(t['--font-heading']).toMatch(/Lora/);
    expect(t['--font-body']).toMatch(/Inter/);
    expect(t['--font-mono']).toMatch(/JetBrains Mono/);
    expect(t['--text-h1']).toBe('34px');
    expect(t['--text-h2']).toBe('22px');
    expect(t['--text-h3']).toBe('15px');
    expect(t['--text-body']).toBe('15.5px');
    expect(t['--text-lede']).toBe('17px');
    expect(t['--text-code']).toBe('13px');
    expect(t['--text-sm']).toBe('13.5px');
    expect(t['--text-xs']).toBe('12px');
    expect(t['--text-2xs']).toBe('11px');
    expect(t['--weight-heading']).toBe('600');
    expect(t['--weight-body']).toBe('400');
    expect(t['--weight-lede']).toBe('400');
    // Layering.
    expect(t['--z-popover']).toBe('1100');
    expect(t['--z-toast']).toBe('1300');
    // Every name resolves to something.
    for (const name of HOST_TOKEN_NAMES) expect(t[name], name).not.toBe('');
  });

  it('[ac:ac-zmienne-typografii-mostu-tokenow-maja] every one of the 15 typography variables resolves to the same value in Base and dark mode', async () => {
    const typography = TYPOGRAPHY as HostTokenName[];
    expect(typography).toEqual(expect.arrayContaining(['--text-sm', '--text-xs', '--text-2xs']));
    const base = readHostTokens();
    await setDark(true);
    const dark = readHostTokens();
    for (const name of typography) {
      expect(base[name], name).not.toBe('');
      expect(dark[name], `${name} (dark)`).toBe(base[name]);
    }
  });
});

/**
 * The bridge name → `c4s-paper-terra` token it carries, with the entity's value
 * in Base mode and under the `dark` mode override. Colours resolve per mode;
 * typography and layering have one value (no dark entry).
 *
 * The correspondence itself is kept by hand (no linter compares the entity
 * with the code — M34 `m34l12sc`); this table is the written-down result of
 * that manual check, and the test holds the code to it.
 */
const PAPER_TERRA: ReadonlyArray<[HostTokenName, string, string, string?]> = [
  ['--c-bg', 'color-bg ← paper-bg', '#faf8f4', '#1b1a17'],
  ['--c-panel', 'color-panel ← paper-panel', '#f3efe7', '#242320'],
  ['--c-card', 'color-card ← paper-card', '#fffdf8', '#2c2b27'],
  ['--c-ink', 'color-ink ← ink-900', '#2a2722', '#ece7dc'],
  ['--c-muted', 'color-muted ← ink-500', '#7a7368', '#9a9184'],
  ['--c-subtle', 'color-subtle ← ink-300', '#a39b8e', '#6a6357'],
  ['--c-hair', 'color-hair ← paper-hair', '#e8e2d5', '#383530'],
  ['--c-hair-strong', 'color-hair-strong ← paper-hair-strong', '#d8d1c0', '#4a463e'],
  ['--c-accent', 'color-accent ← terra', '#c45a3b', '#e07a5c'],
  ['--c-accent-soft', 'color-accent-soft ← terra-soft', '#f5dfd3', '#4a2a1e'],
  ['--c-accent-ink', 'color-accent-ink ← terra-ink', '#8a3a22', '#f3b49a'],
  ['--c-yellow', 'color-warning ← yellow', '#f9e6a2', '#5a4820'],
  ['--c-yellow-ink', 'color-warning-ink ← yellow-ink', '#7a5c00', '#e8cf7a'],
  ['--c-green', 'color-success ← green', '#6e8a5f', '#8fa87f'],
  ['--c-green-soft', 'color-success-soft ← green-soft', '#dfe7d6', '#2f3d28'],
  ['--c-blue', 'color-info ← blue', '#5d7ea2', '#8aa5c9'],
  ['--c-blue-soft', 'color-info-soft ← blue-soft', '#d8e2ef', '#2a3646'],
  ['--c-purple', 'color-purple ← purple', '#8a6da3', '#b39cca'],
  ['--c-purple-soft', 'color-purple-soft ← purple-soft', '#e3d8ec', '#3a2f46'],
  ['--c-red', 'color-danger ← red', '#b6553c', '#d87a5f'],
  ['--c-red-soft', 'color-danger-soft ← red-soft', '#efd4c9', '#4a2820'],
  ['--font-heading', 'font-serif', "'Lora', Georgia, serif"],
  ['--font-body', 'font-sans', "'Inter', system-ui, sans-serif"],
  ['--font-mono', 'font-mono', "'JetBrains Mono', ui-monospace, monospace"],
  ['--text-h1', 'text-h1', '34px'],
  ['--text-h2', 'text-h2', '22px'],
  ['--text-h3', 'text-h3', '15px'],
  ['--text-body', 'text-body', '15.5px'],
  ['--text-lede', 'text-lede', '17px'],
  ['--text-code', 'text-code', '13px'],
  ['--text-sm', 'text-sm', '13.5px'],
  ['--text-xs', 'text-xs', '12px'],
  ['--text-2xs', 'text-2xs', '11px'],
  ['--weight-heading', 'weight-semibold', '600'],
  ['--weight-body', 'weight-regular', '400'],
  ['--weight-lede', 'weight-regular', '400'],
  ['--z-popover', 'z-popover', '1100'],
  ['--z-toast', 'z-toast', '1300'],
];

/** Font stacks compare without quoting: the entity lists family names bare. */
const normalise = (v: string) => v.replace(/["']/g, '').replace(/\s*,\s*/g, ', ').trim();

describe('token bridge — identity with c4s-paper-terra (M34/L12)', () => {
  it('[ac:ac-most-tokenow-wystawia-rozmiary-interf] the UI text sizes --text-sm / --text-xs / --text-2xs carry the c4s-paper-terra text-sm / text-xs / text-2xs values (the manual entity check, written down)', () => {
    const t = pluginRuntimeUi.readHostTokens();
    expect(t['--text-sm']).toBe('13.5px');
    expect(t['--text-xs']).toBe('12px');
    expect(t['--text-2xs']).toBe('11px');
  });

  it('[ac:ac-tokeny-wystawiane-przez-c4s-plugin-runt] every token exposed by @c4s/plugin-runtime/ui resolves to its c4s-paper-terra value, in Base and dark mode', async () => {
    // The table covers exactly the exposed names.
    expect(PAPER_TERRA.map(([n]) => n)).toEqual([...pluginRuntimeUi.HOST_TOKEN_NAMES]);

    const base = pluginRuntimeUi.readHostTokens();
    for (const [name, token, value] of PAPER_TERRA) {
      expect(normalise(base[name]), `${name} (${token})`).toBe(normalise(value));
    }

    await setDark(true);
    const dark = pluginRuntimeUi.readHostTokens();
    for (const [name, token, value, darkValue] of PAPER_TERRA) {
      expect(normalise(dark[name]), `${name} (${token}, dark)`).toBe(normalise(darkValue ?? value));
    }
  });
});

describe('useHostTokens (M34/L12)', () => {
  it('[ac:ac-usehosttokens-zwraca-nowe-wartosci-ko] returns new colour values after the theme mode is switched', async () => {
    const seen: Record<HostTokenName, string>[] = [];
    function Probe() {
      seen.push(useHostTokens());
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
    });
    const light = seen[seen.length - 1]!;
    expect(light['--c-bg']).toBe('#faf8f4');
    expect(light['--c-ink']).toBe('#2a2722');

    await setDark(true);
    const dark = seen[seen.length - 1]!;
    // Colours follow the mode (entity `dark` overrides)…
    expect(dark['--c-bg']).toBe('#1b1a17');
    expect(dark['--c-ink']).toBe('#ece7dc');
    expect(dark['--c-accent']).toBe('#e07a5c');
    // …typography and layering do not.
    expect(dark['--text-h1']).toBe(light['--text-h1']);
    expect(dark['--z-toast']).toBe(light['--z-toast']);

    await setDark(false);
    expect(seen[seen.length - 1]!['--c-bg']).toBe('#faf8f4');
  });
});

describe('GroupedEntityList colours (M34/L12)', () => {
  function renderedVars(): string[] {
    const names = new Set<string>();
    for (const el of host.querySelectorAll<HTMLElement>('[style]')) {
      for (const m of (el.getAttribute('style') ?? '').matchAll(/var\((--[\w-]+)\)/g)) names.add(m[1]!);
    }
    return [...names].sort();
  }

  it('[ac:ac-groupedentitylist-rysuje-tekst-pomocn] draws all its colours with bridge variables only (helper text, headings, rules), resolved in both theme modes', async () => {
    await act(async () => {
      root.render(
        createElement(StringGroupedList, {
          groups: [
            { key: 'a', label: 'Server A', items: ['one'] },
            { key: 'b', label: 'Server B', items: [] },
          ],
          renderRow: (item: string) => createElement('div', { key: item }, item),
          emptyGroupState: 'No tools yet',
        }),
      );
    });

    const used = renderedVars();
    // Heading text + empty-group helper text in `--c-muted`, the heading rule in `--c-hair`.
    expect(used).toEqual(['--c-hair', '--c-muted']);
    for (const name of used) expect(HOST_TOKEN_NAMES as readonly string[]).toContain(name);
    // No colour of its own: every colour in the rendered markup is a bridge variable.
    expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);

    const heading = host.querySelector<HTMLElement>('h2')!;
    expect(heading.style.color).toBe('var(--c-muted)');
    expect(heading.getAttribute('style')).toContain('var(--c-hair)');
    const helper = [...host.querySelectorAll<HTMLElement>('div')].find((d) => d.textContent === 'No tools yet')!;
    expect(helper.style.color).toBe('var(--c-muted)');

    // Both colours resolve — and differ — in Base and dark mode.
    const resolve = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const lightValues = used.map(resolve);
    await setDark(true);
    const darkValues = used.map(resolve);
    for (const v of [...lightValues, ...darkValues]) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    expect(darkValues).not.toEqual(lightValues);
  });
});
