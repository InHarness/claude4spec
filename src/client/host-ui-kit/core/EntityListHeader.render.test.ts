// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { List, type LucideIcon } from 'lucide-react';
import { EntityListHeader, type EntityListHeaderProps } from './EntityListHeader.js';
import { EntityListRow, type EntityListRowProps } from '../list/EntityListRow.js';
import { SegmentedControlTabs } from '../detail/SegmentedControlTabs.js';
import { UI_KIT_CATALOG } from '../registry.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../../shared/plugin-host/ui-kit-surface.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../../shared/plugin-host/host-api.js';
import { SHARED_PEER_SPECIFIERS } from '../../../shared/plugin-host/frontend-manifest.js';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type * as Published from '../../../plugin-types/ui.js';

/**
 * M19 `m19l12sc` (2.1.16) — `EntityListHeader` has an explicit prop contract
 * with no default values: `title` required; `icon`, `count` ("N results"),
 * `search` / `onSearchChange` / `searchPlaceholder`, `filters`, `actions`
 * optional. Omitting `search` hides the search box; the `filters` slot stands
 * between search and actions, `actions` at the trailing edge. The list-page
 * pattern has one empty state and the catalog has no error state.
 */

const render = (props: EntityListHeaderProps) => renderToStaticMarkup(createElement(EntityListHeader, props));

describe('EntityListHeader — prop contract (M19 m19l12sc)', () => {
  it('[section:m19l12sc] only the title is required; nothing optional is rendered by default', () => {
    // Type-level: `title` alone satisfies the contract.
    const minimal: EntityListHeaderProps = { title: 'Endpoints' };
    const html = render(minimal);
    expect(html).toContain('Endpoints');
    expect(html).not.toContain('<input');
    expect(html).not.toMatch(/results?</);
    expect(html).not.toContain('<svg');
  });

  it('[section:m19l12sc] count renders as "N results"; search renders with its placeholder', () => {
    const html = render({
      icon: List,
      title: 'Endpoints',
      count: 3,
      search: 'abc',
      onSearchChange: () => {},
      searchPlaceholder: 'Search endpoints…',
    });
    expect(html).toContain('3 results');
    expect(html).toContain('value="abc"');
    expect(html).toContain('placeholder="Search endpoints…"');
    expect(html).toContain('<svg');
  });

  it('[section:m19l12sc] slot order: search, then filters, then actions at the trailing edge', () => {
    const html = render({
      title: 'Endpoints',
      search: '',
      onSearchChange: () => {},
      filters: createElement('span', { 'data-slot': 'filters' }),
      actions: createElement('span', { 'data-slot': 'actions' }),
    });
    const iSearch = html.indexOf('<input');
    const iFilters = html.indexOf('data-slot="filters"');
    const iActions = html.indexOf('data-slot="actions"');
    expect(iSearch).toBeGreaterThan(-1);
    expect(iSearch).toBeLessThan(iFilters);
    expect(iFilters).toBeLessThan(iActions);
    // `actions` is the last thing in the header (inside its own non-shrinking slot wrapper, 2.1.35;
    // the first line sits in the header box since 2.1.37).
    expect(html.slice(iActions)).toMatch(/^data-slot="actions"><\/span><\/div><\/div><\/div>$/);
  });

  it('[section:m19l12sc] the list catalog offers one empty state and no error state', () => {
    const names = UI_KIT_CATALOG.map((c) => c.name);
    expect(names).toContain('EmptyState');
    expect(names).toContain('LoadingState');
    expect(names.filter((n) => /error/i.test(n))).toEqual([]);
  });
});

// ── 2.1.28 — the `ui-kit-component` record `entity-list-header` is the contract ──

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;
/** Exact type identity (no `any` slipping through as "assignable both ways"). */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The record's `props`, as written (2.1.28): no defaults, only `title` required. */
interface EntityListHeaderRecordProps {
  icon?: LucideIcon;
  title: string;
  count?: number;
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = (el: ReactNode) => act(() => root.render(el));
/** The header's first line (2.1.37: the header box may hold a second one). */
const firstLine = () => host.querySelector('[data-line="1"]') as HTMLElement;
/** The row cell is the element itself or wraps it (slots sit in a wrapper since 2.1.35). */
const holds = (cell: Element, sel: string) => cell.matches(sel) || cell.querySelector(sel) != null;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Resolved with node:path from the module's own file path — under happy-dom the global `URL`
// is the window's, so `new URL(rel, import.meta.url)` is not a `file:` URL that `fileURLToPath`
// accepts (same pattern as ToastViewport.render.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));
const repoFile = (rel: string) => readFileSync(resolve(HERE, '../../../..', rel), 'utf8');

describe('EntityListHeader ↔ record `entity-list-header` (M19/L12, 2.1.28)', () => {
  it('[entity:entity-list-header] takes exactly the record props, host and published /ui alike — no onCreate / createLabel', () => {
    const a: Same<EntityListHeaderProps, EntityListHeaderRecordProps> = true;
    const b: Same<Published.EntityListHeaderProps, EntityListHeaderRecordProps> = true;
    expect([a, b]).toEqual([true, true]);
    // The `actions` slot stays generic: the create flow is not part of the stable contract.
    type Keys = keyof EntityListHeaderProps;
    const noCreate: Exact<Extract<Keys, 'onCreate' | 'createLabel'>, never> = true;
    expect(noCreate).toBe(true);
    // Stable, presentational, in the core group, on the versioned stable list.
    // The component is a function carrying its catalog constants as static fields (withStability);
    // toMatchObject refuses a function receiver, so read the fields off it and check the registry entry.
    expect({ stability: EntityListHeader.stability, binding: EntityListHeader.binding }).toEqual({
      stability: 'stable',
      binding: 'presentational',
    });
    expect((EntityListHeader as { l11Surfaces?: unknown }).l11Surfaces).toBeUndefined();
    expect(UI_KIT_CATALOG.find((c) => c.name === 'EntityListHeader')).toEqual({
      name: 'EntityListHeader',
      group: 'core',
      stability: 'stable',
      binding: 'presentational',
    });
    expect(UI_KIT_STABLE_COMPONENTS as readonly string[]).toContain('EntityListHeader');
  });

  it('[entity:entity-list-header] renders the count as "N results"; without `count` no counter', () => {
    mount(createElement(EntityListHeader, { title: 'Endpoints', count: 7 }));
    expect(host.querySelector('h2')?.textContent).toBe('Endpoints');
    expect(host.textContent).toContain('7 results');
    mount(createElement(EntityListHeader, { title: 'Endpoints' }));
    expect(host.textContent).not.toMatch(/results?/);
  });

  it('[entity:entity-list-header] omitting `search` hides the search field; with it the field (280 px basis) reports typing through onSearchChange', () => {
    mount(createElement(EntityListHeader, { title: 'Endpoints' }));
    expect(host.querySelector('input')).toBeNull();

    const onSearchChange = vi.fn();
    mount(createElement(EntityListHeader, { title: 'Endpoints', search: '', onSearchChange, searchPlaceholder: 'Search…' }));
    const input = host.querySelector('input')!;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Search…');
    expect((input.parentElement as HTMLElement).style.flexBasis).toBe('280px');
    type(input, 'users');
    expect(onSearchChange).toHaveBeenCalledWith('users');
  });

  it('[entity:entity-list-header] the `filters` slot stands between search and actions, `actions` at the trailing edge', () => {
    mount(
      createElement(EntityListHeader, {
        icon: List,
        title: 'Endpoints',
        search: '',
        onSearchChange: () => {},
        filters: createElement('span', { 'data-slot': 'filters' }),
        actions: createElement('button', { 'data-slot': 'actions' }, 'New'),
      }),
    );
    const bar = firstLine();
    const kids = Array.from(bar.children) as HTMLElement[];
    const iSearch = kids.findIndex((k) => k.querySelector('input'));
    const iFilters = kids.findIndex((k) => holds(k, '[data-slot="filters"]'));
    const iActions = kids.findIndex((k) => holds(k, '[data-slot="actions"]'));
    expect(iSearch).toBeGreaterThan(-1);
    expect(iSearch).toBeLessThan(iFilters);
    expect(iFilters).toBeLessThan(iActions);
    expect(iActions).toBe(kids.length - 1);
    // The icon renders first.
    expect(kids[0]!.tagName.toLowerCase()).toBe('svg');
  });

  it('[entity:entity-list-header] there is no separate CountBadge component in the catalog', () => {
    expect(UI_KIT_CATALOG.map((c) => c.name)).not.toContain('CountBadge');
  });
});

// ── 2.1.33 — the `filters` slot is for compact one-row controls; no place for TagFilterBar ──

const REPO = resolve(HERE, '../../../..');
/** Source without comments (`://` in strings survives). */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sourcesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      sourcesUnder(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every expression passed as `filters` — JSX `filters={…}` or an object/createElement `filters: …`. */
function filtersExpressions(src: string): string[] {
  const out: string[] = [];
  const re = /\bfilters\s*(=\s*\{|:)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const jsx = m[1]!.startsWith('=');
    let depth = jsx ? 1 : 0;
    let i = re.lastIndex;
    for (; i < src.length; i++) {
      const ch = src[i]!;
      if ('({['.includes(ch)) depth++;
      else if (')}]'.includes(ch)) {
        depth--;
        if (depth < 0 || (jsx && depth === 0)) break;
      } else if (!jsx && depth === 0 && (ch === ',' || ch === ';')) break;
    }
    out.push(src.slice(re.lastIndex, i));
  }
  return out;
}

describe('EntityListHeader — the `filters` slot (record `entity-list-header`, 2.1.33)', () => {
  it('[entity:entity-list-header] `filters` shares the one header row with title, search and actions and holds compact controls such as SegmentedControlTabs', () => {
    mount(
      createElement(EntityListHeader, {
        title: 'Acceptance criteria',
        count: 3,
        search: '',
        onSearchChange: () => {},
        filters: createElement(SegmentedControlTabs, {
          tabs: [
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
          ],
          active: 'all',
          onChange: () => {},
        }),
        actions: createElement('button', { 'data-slot': 'actions' }, 'New AC'),
      }),
    );
    const row = firstLine();
    // One non-wrapping flex row…
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'items-center']));
    expect(row.className).not.toMatch(/flex-wrap|flex-col/);
    // …whose cells are the title, the search, the compact filter control and the actions
    // (each slot in its own non-shrinking wrapper since 2.1.35).
    const kids = Array.from(row.children) as HTMLElement[];
    const iTitle = kids.findIndex((k) => k.tagName === 'H2');
    const iSearch = kids.findIndex((k) => k.querySelector('input'));
    const iFilters = kids.findIndex((k) => holds(k, '[role="tablist"]'));
    const iActions = kids.findIndex((k) => holds(k, '[data-slot="actions"]'));
    expect([iTitle, iSearch, iFilters, iActions].every((i) => i > -1)).toBe(true);
    expect(iTitle).toBeLessThan(iSearch);
    expect(iSearch).toBeLessThan(iFilters);
    expect(iFilters).toBeLessThan(iActions);
  });

  it('[entity:entity-list-header] has no place for TagFilterBar — no host or plugin source passes it in the `filters` slot (removed without alias); it stands under the header in EntityListLayout.header', () => {
    const files = [
      ...sourcesUnder(join(REPO, 'src/client')),
      ...readdirSync(join(REPO, 'plugins'))
        .map((d) => join(REPO, 'plugins', d, 'src'))
        .filter((d) => {
          try {
            return statSync(d).isDirectory();
          } catch {
            return false;
          }
        })
        .flatMap((d) => sourcesUnder(d)),
    ];
    const offenders: string[] = [];
    let tagBarUsers = 0;
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/<TagFilterBar\b|createElement\(\s*(?:ui\.)?TagFilterBar\b/.test(src)) tagBarUsers++;
      if (filtersExpressions(src).some((e) => /\bTagFilterBar\b/.test(e))) offenders.push(relative(REPO, file));
    }
    expect(offenders).toEqual([]);
    // The scan is not vacuous: the plugin list pages do render the tag bar.
    expect(tagBarUsers).toBeGreaterThan(0);
    // The extractor itself catches both spellings of the old composition.
    expect(filtersExpressions('<EntityListHeader title="x" filters={<TagFilterBar {...bar} />} />')[0]).toMatch(/TagFilterBar/);
    expect(filtersExpressions('createElement(H, { filters: createElement(ui.TagFilterBar, p), actions })')[0]).toMatch(/TagFilterBar/);
    // The header itself carries no tag-bar prop: its props are exactly the record's (no tags/tagFilter).
    type Keys = keyof EntityListHeaderProps;
    const noTagProps: Exact<Extract<Keys, 'tags' | 'tagFilter' | 'onTagToggle'>, never> = true;
    expect(noTagProps).toBe(true);
  });
});

describe('icon type across tiers (M34/L12, 2.1.28)', () => {
  it('[ac:ac-entitylistrow-icon-experimental-m34] EntityListRow.icon (experimental) and EntityListHeader.icon (stable) share the one LucideIcon type of the lucide peer — in the host and in the published /ui', () => {
    type HeaderIcon = NonNullable<EntityListHeaderProps['icon']>;
    type RowIcon = NonNullable<EntityListRowProps['icon']>;
    type PubHeaderIcon = NonNullable<Published.EntityListHeaderProps['icon']>;
    type PubRowIcon = NonNullable<Published.EntityListRowProps['icon']>;
    const checks: [
      Exact<HeaderIcon, LucideIcon>,
      Exact<RowIcon, LucideIcon>,
      Exact<PubHeaderIcon, LucideIcon>,
      Exact<PubRowIcon, LucideIcon>,
      Exact<HeaderIcon, RowIcon>,
    ] = [true, true, true, true, true];
    expect(checks).toEqual([true, true, true, true, true]);

    // The two components sit in different tiers…
    const tier = (n: string) => UI_KIT_CATALOG.find((c) => c.name === n)?.stability;
    expect(tier('EntityListHeader')).toBe('stable');
    expect(tier('EntityListRow')).toBe('experimental');

    // …and one lucide icon component feeds both.
    mount(
      createElement('div', null,
        createElement(EntityListHeader, { icon: List, title: 'Endpoints' }),
        createElement(EntityListRow, { icon: List, tagLookup: new Map(), children: 'GET /users' }),
      ),
    );
    const icons = Array.from(host.querySelectorAll('svg'));
    expect(icons).toHaveLength(2);
    expect(icons[0]!.getAttribute('class')).toBe(icons[1]!.getAttribute('class'));
  });
});

describe('LucideIcon in the stable props (L12/L11, 2.1.28)', () => {
  it('[ac:ac-typ-lucideicon-w-stable-propsach-l12] EntityListHeader.icon resolves to the declared lucide-react peer and is part of the published …/plugin-runtime/ui types, additively within the HOST_API_VERSION baseline', () => {
    // The published prop is typed with lucide-react's own `LucideIcon`, not a local alias.
    const exact: Exact<NonNullable<Published.EntityListHeaderProps['icon']>, LucideIcon> = true;
    expect(exact).toBe(true);
    const published = repoFile('src/plugin-types/ui.ts');
    expect(published).toMatch(/^import type \{ LucideIcon \} from 'lucide-react';$/m);
    expect(published).not.toMatch(/\btype LucideIcon\s*=/);
    expect(published).toMatch(/export interface EntityListHeaderProps \{[^}]*\bicon\?: LucideIcon;/);
    // lucide-react is a declared, shared peer (one instance via the import map)…
    expect(SHARED_PEER_SPECIFIERS as readonly string[]).toContain('lucide-react');
    // …and a dependency of the published package, so the emitted .d.ts reference resolves for a plugin.
    const pkg = JSON.parse(repoFile('package.json')) as { dependencies?: Record<string, string>; exports: Record<string, { types?: string }> };
    expect(pkg.dependencies?.['lucide-react']).toBeTruthy();
    expect(pkg.exports['./plugin-runtime/ui']?.types).toBe('./dist/plugin-types/ui.d.ts');
    // The component is stable, so its props (icon type included) are in the versioned surface…
    expect(UI_KIT_STABLE_COMPONENTS as readonly string[]).toContain('EntityListHeader');
    expect(VERSIONED_UI_KIT_COMPONENTS as readonly string[]).toContain('EntityListHeader');
    // …added within the current baseline, without a bump.
    expect(HOST_API_VERSION).toBe('2.1.0');
  });
});

// ── 2.1.35 — explicit shrink order in a narrow panel ──
// happy-dom computes no layout, so these pin the classes and styles that force the behaviour.

const classesOf = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

function mountFull(extra: Partial<EntityListHeaderProps> = {}) {
  mount(
    createElement(EntityListHeader, {
      icon: List,
      title: 'A rather long list title that may not fit',
      count: 12,
      search: '',
      onSearchChange: () => {},
      filters: createElement('span', { 'data-slot': 'filters' }, 'All'),
      actions: createElement('button', { 'data-slot': 'actions' }, 'New'),
      ...extra,
    }),
  );
  const row = firstLine();
  return {
    row,
    title: row.querySelector('h2') as HTMLElement,
    searchBox: (row.querySelector('input')?.parentElement ?? null) as HTMLElement | null,
    counter: Array.from(row.children).find((k) => /\bresults?\b/.test(k.textContent ?? '')) as HTMLElement,
    cell: (sel: string) => Array.from(row.children).find((k) => holds(k, sel)) as HTMLElement,
  };
}

describe('EntityListHeader — shrink order (record `entity-list-header`, 2.1.35)', () => {
  it('[ac:ac-przy-zwezaniu-panelu-pole-wyszukiwani] the search box narrows from 280 px to 160 px before the title truncates', () => {
    const { title, searchBox } = mountFull();
    expect(searchBox).not.toBeNull();
    // Max 280 px (the basis, never grows), min 160 px; no rigid width any more.
    expect(searchBox!.style.flexBasis).toBe('280px');
    expect(searchBox!.style.flexGrow).toBe('0');
    expect(searchBox!.style.minWidth).toBe('160px');
    expect(searchBox!.style.width).toBe('');
    // It takes the deficit first: its shrink factor dwarfs the title's default 1.
    expect(Number(searchBox!.style.flexShrink)).toBeGreaterThanOrEqual(1000);
    expect(classesOf(title).some((c) => /^shrink/.test(c))).toBe(false);
    expect(title.style.flexShrink).toBe('');
    // The input inside may narrow along with its box.
    expect(classesOf(searchBox!.querySelector('input'))).toContain('min-w-0');
  });

  it('[ac:ac-gdy-pole-wyszukiwania-entitylistheade] once the search box is at 160 px or hidden, the title truncates with an ellipsis on one line', () => {
    const withSearch = mountFull();
    expect(classesOf(withSearch.title)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));

    // Without `search` there is no search box at all — the title is the first to give way.
    const noSearch = mountFull({ search: undefined, onSearchChange: undefined });
    expect(noSearch.searchBox).toBeNull();
    expect(noSearch.row.querySelector('input')).toBeNull();
    expect(classesOf(noSearch.title)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
  });

  it('[ac:ac-licznik-wynikow-oraz-zawartosc-slotow] the counter and the `filters` / `actions` slots keep their natural width on one line', () => {
    const { row, counter, cell } = mountFull();
    expect(classesOf(counter)).toEqual(expect.arrayContaining(['whitespace-nowrap', 'shrink-0']));
    const filtersCell = cell('[data-slot="filters"]');
    const actionsCell = cell('[data-slot="actions"]');
    expect(classesOf(filtersCell)).toContain('shrink-0');
    expect(classesOf(actionsCell)).toContain('shrink-0');
    // The leading icon does not give way either.
    expect((row.firstElementChild as SVGElement).style.flexShrink).toBe('0');
    // The row itself never wraps.
    expect(classesOf(row)).not.toContain('flex-wrap');
    expect(row.style.flexWrap).toBe('');
  });
});

// ── 2.1.37 — shrink phases 1–4: title minimum, `filters` on a second line, the counter hides ──
// happy-dom computes no layout, so element widths are stubbed: the panel (first line), the
// off-screen natural-width copies of the title / counter, and the slot areas. The current
// widths of the title and the search box are deliberately noise — the phases must not read them.

const W = { icon: 18, titleFull: 300, titleMin: 50, count: 70, search: 160, filters: 260, actions: 80, gap: 12 };
/** First line with everything at the minimum values: icon, title min, count, spacer, search, filters, actions. */
const ONE_LINE_MIN = W.icon + W.titleMin + W.count + 0 + W.search + W.filters + W.actions + 6 * W.gap; // 710
/** …without the `filters` area. */
const NO_FILTERS_MIN = W.icon + W.titleMin + W.count + 0 + W.search + W.actions + 5 * W.gap; // 438
/** Lower threshold: icon, title min, spacer, search 160, actions. */
const LOWER_THRESHOLD = W.icon + W.titleMin + 0 + W.search + W.actions + 4 * W.gap; // 356

const PHASE_TITLE = 'Acceptance criteria';
let panel = 1000;

function stubWidths() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = (width: number) => ({ width, height: 20, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 20, toJSON() {} }) as DOMRect;
    const el = this as HTMLElement;
    if (el.matches('[data-line="1"]')) return box(panel);
    if (el.tagName === 'SPAN' && el.closest('[aria-hidden]')) {
      const text = el.textContent ?? '';
      if (/results?$/.test(text)) return box(W.count);
      if (text.endsWith('…')) return box(W.titleMin);
      return box(text === PHASE_TITLE ? W.titleFull : 30);
    }
    if (el.classList.contains('shrink-0') && el.querySelector('[data-slot="filters"]')) return box(W.filters);
    if (el.classList.contains('shrink-0') && el.querySelector('[data-slot="actions"]')) return box(W.actions);
    // Current widths of the title / search box: arbitrary, must not matter.
    return box(Math.random() * 400);
  });
}

function mountAt(width: number, extra: Partial<EntityListHeaderProps> = {}) {
  panel = width;
  mount(
    createElement(EntityListHeader, {
      icon: List,
      title: PHASE_TITLE,
      count: 12,
      search: '',
      onSearchChange: () => {},
      filters: createElement('span', { 'data-slot': 'filters' }, 'All · Active'),
      actions: createElement('button', { 'data-slot': 'actions' }, 'New AC'),
      ...extra,
    }),
  );
  const line1 = firstLine();
  const line2 = host.querySelector('[data-line="2"]') as HTMLElement | null;
  return {
    line1,
    line2,
    title: line1.querySelector('h2') as HTMLElement,
    counterShown: Array.from(line1.children).some((k) => /\bresults?\b/.test(k.textContent ?? '')),
    filtersOn: (line: HTMLElement | null) => line?.querySelector('[data-slot="filters"]') != null,
    actionsOnLine1: line1.querySelector('[data-slot="actions"]') != null,
  };
}

describe('EntityListHeader — shrink phases (record `entity-list-header`, 2.1.37)', () => {
  beforeEach(stubWidths);

  it('[ac:ac-tytul-entitylistheader-nie-zweza-sie] the title never narrows below ~4 characters with an ellipsis', () => {
    const { title } = mountAt(LOWER_THRESHOLD);
    // The minimum is the natural width of the first 4 characters + "…".
    const minCopy = Array.from(host.querySelectorAll('[aria-hidden] span')).find((s) => s.textContent!.endsWith('…'));
    expect(minCopy?.textContent).toBe('Acce…');
    expect(title.style.minWidth).toBe(`${W.titleMin}px`);
    expect(title.textContent).toBe(PHASE_TITLE);
    expect(classesOf(title)).toContain('truncate');
    // A title no longer than the minimum keeps its own width (no padding, no ellipsis copy).
    mountAt(LOWER_THRESHOLD, { title: 'API' });
    expect(Array.from(host.querySelectorAll('[aria-hidden] span')).some((s) => s.textContent!.endsWith('…'))).toBe(false);
    expect(firstLine().querySelector('h2')!.style.minWidth).toBe('30px');
  });

  it('[ac:ac-gdy-pole-wyszukiwania-entitylistheade] with the search box at 160 px or hidden, the title truncates on one line down to its minimum width at most', () => {
    const withSearch = mountAt(NO_FILTERS_MIN);
    expect(classesOf(withSearch.title)).toEqual(expect.arrayContaining(['truncate']));
    expect(withSearch.title.style.minWidth).toBe(`${W.titleMin}px`);
    const noSearch = mountAt(NO_FILTERS_MIN - W.search, { search: undefined, onSearchChange: undefined });
    expect(noSearch.line1.querySelector('input')).toBeNull();
    expect(classesOf(noSearch.title)).toEqual(expect.arrayContaining(['truncate']));
    expect(noSearch.title.style.minWidth).toBe(`${W.titleMin}px`);
  });

  it('[ac:ac-gdy-pierwsza-linia-entitylistheader-n] when the first line does not fit at search 160 px and the minimum title, the whole `filters` area moves to a second line', () => {
    const wide = mountAt(ONE_LINE_MIN);
    expect(wide.line2).toBeNull();
    expect(wide.filtersOn(wide.line1)).toBe(true);

    const narrow = mountAt(ONE_LINE_MIN - 1);
    expect(narrow.filtersOn(narrow.line1)).toBe(false);
    expect(narrow.filtersOn(narrow.line2)).toBe(true);
    // The area moves whole, in its own non-shrinking wrapper…
    expect(narrow.line2!.querySelectorAll('[data-slot="filters"]')).toHaveLength(1);
    expect(classesOf(narrow.line2!.firstElementChild)).toContain('shrink-0');
    // …aligned with the title text (past the 18 px icon + 12 px gap), not with the icon.
    expect(narrow.line2!.style.paddingLeft).toBe(`${W.icon + W.gap}px`);
    // `actions` and the counter stay on the first line.
    expect(narrow.actionsOnLine1).toBe(true);
    expect(narrow.counterShown).toBe(true);
    // Without an icon the second line starts at the title's left edge.
    const noIcon = mountAt(ONE_LINE_MIN - 1 - W.icon - W.gap, { icon: undefined });
    expect(noIcon.line2!.style.paddingLeft).toBe('0px');
  });

  it('[ac:ac-gdy-pierwsza-linia-entitylistheader-n-2] when the first line does not fit even without `filters`, the counter hides as the last step', () => {
    const fits = mountAt(NO_FILTERS_MIN);
    expect(fits.counterShown).toBe(true);
    expect(fits.filtersOn(fits.line2)).toBe(true);

    const tight = mountAt(NO_FILTERS_MIN - 1);
    expect(tight.counterShown).toBe(false);
    expect(tight.filtersOn(tight.line2)).toBe(true);
    expect(tight.actionsOnLine1).toBe(true);
    expect(tight.title.textContent).toBe(PHASE_TITLE);

    // An empty `filters` slot: phase 3 brings nothing, the counter goes when the line does not fit.
    const noFilters = { filters: undefined };
    expect(mountAt(NO_FILTERS_MIN, noFilters).counterShown).toBe(true);
    const bare = mountAt(NO_FILTERS_MIN - 1, noFilters);
    expect(bare.counterShown).toBe(false);
    expect(bare.line2).toBeNull();
    expect(bare.actionsOnLine1).toBe(true);
  });

  it('[ac:ac-entitylistheader-wraca-do-ukladu-jedn] returns to one line once the panel fits the first line with `filters` at the minimum values', () => {
    expect(mountAt(NO_FILTERS_MIN - 1).counterShown).toBe(false);
    const back3 = mountAt(NO_FILTERS_MIN);
    expect(back3.counterShown).toBe(true);
    expect(back3.filtersOn(back3.line2)).toBe(true);
    const back1 = mountAt(ONE_LINE_MIN);
    expect(back1.line2).toBeNull();
    expect(back1.filtersOn(back1.line1)).toBe(true);
    expect(back1.counterShown).toBe(true);
  });

  it('[ac:ac-przy-stalej-szerokosci-panelu-entityl] at a fixed panel width the header does not switch between one and two lines', () => {
    // Right at the boundary, from either side, with the current widths of the title and the
    // search box changing on every measurement (stub noise) — the layout is a function of the width.
    for (const width of [ONE_LINE_MIN - 1, ONE_LINE_MIN]) {
      mountAt(width);
      const seen = new Set<boolean>();
      for (let i = 0; i < 10; i++) {
        mountAt(width); // every render re-measures
        seen.add(host.querySelector('[data-line="2"]') != null);
      }
      expect([...seen]).toEqual([width < ONE_LINE_MIN]);
    }
    // Moving `filters` out of the first line does not change the decision for that line.
    const a = mountAt(ONE_LINE_MIN - 1);
    expect(a.line2).not.toBeNull();
    expect(mountAt(ONE_LINE_MIN - 1).line2).not.toBeNull();
  });

  it('[ac:ac-przy-szerokosci-panelu-nie-mniejszej] at or above the lower threshold the `actions` content is whole on the first line; below it the row is clipped at the header edge', () => {
    for (const width of [LOWER_THRESHOLD, NO_FILTERS_MIN, ONE_LINE_MIN, 1200]) {
      const h = mountAt(width);
      expect(h.actionsOnLine1).toBe(true);
      // Nothing beyond the threshold's own sum competes with `actions` on the first line.
      const line1Sum =
        W.icon + W.titleMin + W.search + W.actions + (h.counterShown ? W.count : 0) + (h.filtersOn(h.line1) ? W.filters : 0);
      const items = 5 + (h.counterShown ? 1 : 0) + (h.filtersOn(h.line1) ? 1 : 0);
      expect(line1Sum + (items - 1) * W.gap).toBeLessThanOrEqual(width);
      // The actions wrapper never shrinks.
      expect(classesOf(h.line1.querySelector('[data-slot="actions"]')!.parentElement)).toContain('shrink-0');
    }
    // Below the threshold there is no further phase: the header clips at its right edge.
    const below = mountAt(LOWER_THRESHOLD - 40);
    expect(below.actionsOnLine1).toBe(true);
    expect(classesOf(host.firstElementChild)).toContain('overflow-hidden');
  });
});
