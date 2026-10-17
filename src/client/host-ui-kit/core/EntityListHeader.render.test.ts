// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { List, type LucideIcon } from 'lucide-react';
import { EntityListHeader, type EntityListHeaderProps } from './EntityListHeader.js';
import { EntityListRow, type EntityListRowProps } from '../list/EntityListRow.js';
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
    // `actions` is the last thing in the header.
    expect(html.slice(iActions)).toMatch(/^data-slot="actions"><\/span><\/div>$/);
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

  it('[entity:entity-list-header] omitting `search` hides the search field; with it the field (280 px wide) reports typing through onSearchChange', () => {
    mount(createElement(EntityListHeader, { title: 'Endpoints' }));
    expect(host.querySelector('input')).toBeNull();

    const onSearchChange = vi.fn();
    mount(createElement(EntityListHeader, { title: 'Endpoints', search: '', onSearchChange, searchPlaceholder: 'Search…' }));
    const input = host.querySelector('input')!;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Search…');
    expect((input.parentElement as HTMLElement).style.width).toBe('280px');
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
    const bar = host.firstElementChild as HTMLElement;
    const kids = Array.from(bar.children) as HTMLElement[];
    const iSearch = kids.findIndex((k) => k.querySelector('input'));
    const iFilters = kids.findIndex((k) => k.dataset.slot === 'filters');
    const iActions = kids.findIndex((k) => k.dataset.slot === 'actions');
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
