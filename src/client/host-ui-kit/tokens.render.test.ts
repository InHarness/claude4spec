// @vitest-environment happy-dom
/**
 * M34/L12 — the token bridge of `@c4s/plugin-runtime/ui`: the closed list of
 * host token names (21 colour + 12 typography + 2 layering), the one-shot
 * `readHostTokens()` and the `useHostTokens()` hook that re-reads on a theme
 * mode switch — plus the bridge-only colouring of `GroupedEntityList`.
 *
 * The real `styles/theme.css` (L5) is loaded into the document, so every value
 * asserted here is what the host actually paints.
 */
import { readFileSync } from 'node:fs';
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

const THEME_CSS = readFileSync(
  fileURLToPath(new URL('../styles/theme.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

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
  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] HOST_TOKEN_NAMES is exactly 21 colour + 12 typography + 2 layering names', () => {
    expect([...HOST_TOKEN_NAMES]).toEqual([...COLOR, ...TYPOGRAPHY, ...LAYERING]);
    expect(HOST_TOKEN_NAMES).toHaveLength(35);
  });

  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] the bridge is exported from @c4s/plugin-runtime/ui', () => {
    expect(pluginRuntimeUi.HOST_TOKEN_NAMES).toBe(HOST_TOKEN_NAMES);
    expect(typeof pluginRuntimeUi.readHostTokens).toBe('function');
    expect(typeof pluginRuntimeUi.useHostTokens).toBe('function');
  });

  it('[ac:ac-most-tokenow-c4s-plugin-runtime-ui-eksp] every bridge name is an L5 variable; colours per mode, typography and z-index mode-invariant', () => {
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
    expect(t['--weight-heading']).toBe('600');
    expect(t['--weight-body']).toBe('400');
    expect(t['--weight-lede']).toBe('400');
    // Layering.
    expect(t['--z-popover']).toBe('1100');
    expect(t['--z-toast']).toBe('1300');
    // Every name resolves to something.
    for (const name of HOST_TOKEN_NAMES) expect(t[name], name).not.toBe('');
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

  it('[ac:ac-groupedentitylist-rysuje-tekst-pomocn] draws helper text and rules with bridge colours only, resolved in both theme modes', async () => {
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
