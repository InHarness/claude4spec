// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2.1.84 (M19, M13 `renderRow?`) — list tags on a type without a list view.
 *
 * - `tagged_list` on a type without `renderRow`: one information block whose
 *   count is the type's `listByTags` answer for the tag's `tags` and `filter`.
 * - `tagged_list_mixed`: an ACTIVE type without `renderRow` gets its OWN group,
 *   in its place in the type order, with the information block instead of rows
 *   and the `listByTags` count; that count is part of the list's total.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { rowCalls, matches } = vi.hoisted(() => ({
  rowCalls: [] as string[],
  /** Per type: the slugs carrying tag `x`. */
  matches: {} as Record<string, string[]>,
}));

function RenderRow({ slug }: { slug: string }) {
  rowCalls.push(slug);
  return createElement('span', { 'data-row': slug }, slug);
}
const Chip = ({ slug }: { slug: string }) => createElement('span', { 'data-chip': slug }, slug);
const useGetBySlug = (slug: string | null) => ({ data: slug ? { slug, title: slug } : null, isLoading: false });

function module(type: string, labelPlural: string, withRow: boolean) {
  return {
    type,
    label: type,
    labelPlural,
    ...(withRow ? { renderRow: RenderRow } : {}),
    renderChip: Chip,
    renderCard: Chip,
    useGetBySlug,
    listByTags: vi.fn(async ({ tags, filter }: { tags: string[]; filter: 'and' | 'or' }) => {
      // `filter` is honoured: `and` over x+y matches nothing in this fixture.
      if (filter === 'and' && tags.includes('y')) return [];
      return tags.includes('x') ? (matches[type] ?? []).map((slug) => ({ slug })) : [];
    }),
  };
}

/** Active types, in registry (type) order: listable, hidden, listable, hidden. */
const MODULES = [
  module('endpoint', 'Endpoints', true),
  module('code-snippet', 'Code snippets', false),
  module('dto', 'DTOs', true),
  module('spreadsheet', 'Spreadsheets', false),
];
const BY_TYPE = new Map(MODULES.map((m) => [m.type, m]));

vi.mock('../../../entities/registry.js', () => ({
  getEntityDef: (type: string) => BY_TYPE.get(type) ?? null,
}));
vi.mock('../../../core/plugin-host/useRegistryVersion.js', () => ({ useRegistryVersion: () => 0 }));
vi.mock('../../../core/plugin-host/host.js', () => ({
  categoriseBrokenChip: () => 'inactive-plugin',
  clientPluginHost: {
    listEntities: () => MODULES,
    getEntity: (type: string) => BY_TYPE.get(type) ?? null,
    getAvailable: () => null,
    onRegistryChanged: () => () => {},
  },
}));
vi.mock('../../../entities/openEntity.js', () => ({ openEntityHandler: () => undefined }));
vi.mock('../../../runtime/editor-bridge.js', () => ({ editorBridge: {} }));
vi.mock('../../../entities/useListTagLookup.js', () => ({ useListTagLookup: () => new Map() }));
vi.mock('../../../entities/useRefLookup.js', () => ({ useListRefLookup: () => new Map() }));

const { TaggedListMixedRender } = await import('./TaggedListMixed.js');
const { TaggedListRender } = await import('./TaggedList.js');

let host: HTMLElement;
let root: Root;

async function mount(el: ReactElement): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, el));
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return host;
}

const mixed = (attrs: Record<string, string>) =>
  createElement(TaggedListMixedRender, { name: 'tagged_list_mixed', attrs, variant: 'block' });
const tagged = (attrs: Record<string, string>) =>
  createElement(TaggedListRender, { name: 'tagged_list', attrs, variant: 'block' });

const groups = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-tagged-list-mixed-group]')].map((g) => g.getAttribute('data-tagged-list-mixed-group'));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  rowCalls.length = 0;
  for (const k of Object.keys(matches)) delete matches[k];
  for (const m of MODULES) m.listByTags.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('tagged_list on a type without renderRow (2.1.84)', () => {
  it('[ac:ac-tagged-list-na-typ-bez-slotu-renderro] the information block shows the number of entities of the type carrying the tag\'s tags — the listByTags answer', async () => {
    matches['code-snippet'] = ['s1', 's2', 's3', 's4'];
    const el = await mount(tagged({ type: 'code-snippet', tags: 'x' }));
    const block = el.querySelector('[data-no-list-view="code-snippet"]');
    expect(block).not.toBeNull();
    expect(block!.querySelector('[data-no-list-view-count]')?.getAttribute('data-no-list-view-count')).toBe('4');
    expect(BY_TYPE.get('code-snippet')!.listByTags).toHaveBeenCalledWith({ tags: ['x'], filter: 'and' });
    expect(rowCalls).toEqual([]);
  });

  it('the count follows the tag\'s `filter`: the same answer the type gives a list with rows', async () => {
    matches['code-snippet'] = ['s1', 's2'];
    let el = await mount(tagged({ type: 'code-snippet', tags: 'x,y', filter: 'and' }));
    expect(el.querySelector('[data-no-list-view-count]')?.getAttribute('data-no-list-view-count')).toBe('0');
    el = await mount(tagged({ type: 'code-snippet', tags: 'x,y', filter: 'or' }));
    expect(el.querySelector('[data-no-list-view-count]')?.getAttribute('data-no-list-view-count')).toBe('2');
  });
});

describe('tagged_list_mixed with an active type without renderRow (2.1.84)', () => {
  it('[ac:ac-tagged-list-mixed-ktorego-tagi-niesie] a match of an active type without renderRow shows a group of that type with the information block instead of rows, in its place in the type order', async () => {
    matches.endpoint = ['e1'];
    matches['code-snippet'] = ['s1', 's2'];
    matches.dto = ['d1'];
    const el = await mount(mixed({ tags: 'x' }));

    // Own group, in registry order between the two listable types.
    expect(groups(el)).toEqual(['endpoint', 'code-snippet', 'dto']);
    const group = el.querySelector('[data-tagged-list-mixed-group="code-snippet"]')!;
    expect(group.textContent).toContain('Code snippets');
    const block = group.querySelector('[data-no-list-view="code-snippet"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('type code-snippet has no list view');
    // No rows in that group; the listable groups still draw theirs.
    expect(group.querySelectorAll('li, ul, [data-row]')).toHaveLength(0);
    expect(rowCalls.sort()).toEqual(['d1', 'e1']);
  });

  it('[ac:ac-liczba-w-bloku-informacyjnym-grupy-ty] the number in the group\'s information block equals the number of entities of that type carrying the tag\'s tags, and it counts into the list total', async () => {
    matches.endpoint = ['e1'];
    matches['code-snippet'] = ['s1', 's2'];
    matches.spreadsheet = ['g1', 'g2', 'g3'];
    const el = await mount(mixed({ tags: 'x' }));

    const count = (type: string) =>
      el
        .querySelector(`[data-tagged-list-mixed-group="${type}"] [data-no-list-view-count]`)
        ?.getAttribute('data-no-list-view-count');
    expect(count('code-snippet')).toBe('2');
    expect(count('spreadsheet')).toBe('3');
    // The header total: 1 row + 2 + 3 from the two info-block groups.
    expect(el.textContent).toContain('6');
    expect(el.textContent).not.toContain('No entities match these tags.');
  });

  it('only the hidden type matches: the list is not empty — the group shows, the empty state does not', async () => {
    matches.spreadsheet = ['g1'];
    const el = await mount(mixed({ tags: 'x' }));
    expect(groups(el)).toEqual(['spreadsheet']);
    expect(el.textContent).not.toContain('No entities match these tags.');
  });

  it('a type without renderRow and without matches has no group, like any other type', async () => {
    matches.endpoint = ['e1'];
    const el = await mount(mixed({ tags: 'x' }));
    expect(groups(el)).toEqual(['endpoint']);
    expect(el.querySelectorAll('[data-no-list-view]')).toHaveLength(0);
  });
});
