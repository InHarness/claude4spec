// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2.1.63 (M13 `z7l89jhf`, M19 `m19hidden`, edge case `7dlbor3x`) — an
 * `element_list` / `tagged_list` whose ACTIVE type declares no `renderRow` has
 * no list view: in both pipelines (the page editor's `block` render, the chat's
 * `XmlChipDispatcher`, which renders every tag `inline`) the tag is ONE
 * information block "type `<type>` has no list view" with the number of
 * matching entities — `0` included — and no rows and no chips. The same tag on
 * an inactive type is a broken chip, not the block.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getBySlugs, listByTags, rowCalls, chipCalls } = vi.hoisted(() => ({
  getBySlugs: vi.fn(),
  listByTags: vi.fn(),
  rowCalls: [] as string[],
  chipCalls: [] as string[],
}));

function RenderRow({ slug }: { slug: string }) {
  rowCalls.push(slug);
  return createElement('span', { 'data-row': slug }, slug);
}

function RenderChip({ slug }: { slug: string }) {
  chipCalls.push(slug);
  return createElement('span', { 'data-chip': slug }, slug);
}

const useGetBySlug = (slug: string | null) => ({ data: slug ? { slug, title: slug } : null, isLoading: false });

/** A hidden type without a list view, and a listable one for contrast. */
const DEFS: Record<string, Record<string, unknown>> = {
  'code-snippet': {
    type: 'code-snippet',
    label: 'Code snippet',
    labelPlural: 'Code snippets',
    renderChip: RenderChip,
    renderCard: RenderChip,
    useGetBySlug,
  },
  endpoint: {
    type: 'endpoint',
    label: 'Endpoint',
    labelPlural: 'Endpoints',
    renderRow: RenderRow,
    renderChip: RenderChip,
    renderCard: RenderChip,
    useGetBySlug,
  },
};

vi.mock('../../../entities/registry.js', () => ({
  getEntityDef: (type: string) => DEFS[type] ?? null,
}));
vi.mock('../../../core/plugin-host/useRegistryVersion.js', () => ({ useRegistryVersion: () => 0 }));
vi.mock('../../../core/plugin-host/host.js', () => ({
  categoriseBrokenChip: () => 'inactive-plugin',
  clientPluginHost: {
    getEntity: (type: string) => (DEFS[type] ? { type, listByTags } : null),
    getAvailable: () => null,
    onRegistryChanged: () => () => {},
  },
}));
vi.mock('../../../entities/openEntity.js', () => ({ openEntityHandler: () => undefined }));
vi.mock('../../../entities/useListTagLookup.js', () => ({ useListTagLookup: () => new Map() }));
vi.mock('../../../lib/api.js', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  entitiesApi: { getBySlugs },
}));
vi.mock('../../../runtime/plugin-boot-signal.js', () => ({
  frontendPluginsBooted: Promise.resolve(),
  pluginBootPending: () => false,
  settlePluginBoot: () => {},
}));

const { ElementListRender } = await import('./ElementList.js');
const { TaggedListRender } = await import('./TaggedList.js');
// The chat pipeline picks the render the owning module assigned to the tag —
// these two — through the M51 render registry.
vi.mock('../../renders.js', () => ({
  getTagRender: (name: string) =>
    name === 'element_list' ? ElementListRender : name === 'tagged_list' ? TaggedListRender : undefined,
}));
const { XmlChipDispatcher } = await import('../../../chat/XmlChipDispatcher.js');

let host: HTMLElement;
let root: Root;

async function mount(el: ReactElement): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, el));
  });
  // Let the count query resolve and the block re-render: React Query notifies
  // its observers on a zero-delay timer, so flush timers, not just microtasks.
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return host;
}

const editor = (name: 'element_list' | 'tagged_list', attrs: Record<string, string>) =>
  createElement(name === 'element_list' ? ElementListRender : TaggedListRender, { name, attrs, variant: 'block' });

const chat = (kind: 'element_list' | 'tagged_list', attrs: Record<string, string>) =>
  createElement(XmlChipDispatcher, { chip: { kind, attrs } });

/** The rendered tag holds exactly one info block for `type`, and nothing list-like. */
function expectOneInfoBlock(el: HTMLElement, type: string, count: string): void {
  const blocks = el.querySelectorAll('[data-no-list-view]');
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.getAttribute('data-no-list-view')).toBe(type);
  expect(blocks[0]!.textContent).toContain(`type ${type} has no list view`);
  expect(blocks[0]!.textContent).toContain(count);
  // No rows and no chips: not an empty list, not a chip per slug.
  expect(el.querySelectorAll('li, ul, [data-row], [data-chip]')).toHaveLength(0);
  expect(rowCalls).toEqual([]);
  expect(chipCalls).toEqual([]);
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  rowCalls.length = 0;
  chipCalls.length = 0;
  getBySlugs.mockReset();
  listByTags.mockReset();
  // `c` names no entity: it is listed, but it does not match.
  getBySlugs.mockImplementation(async (_type: string, slugs: string[]) =>
    slugs.map((slug) => ({ slug, entity: slug === 'c' ? null : { slug, title: slug } })),
  );
  listByTags.mockImplementation(async ({ tags }: { tags: string[] }) =>
    tags.includes('x') ? [{ slug: 'a' }, { slug: 'b' }, { slug: 'd' }] : [],
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('list tag on a type without renderRow — one information block (M19 m19hidden)', () => {
  it('[ac:ac-element-list-albo-tagged-list-na-typ] editor: element_list on a type without renderRow is one block "type <type> has no list view" with the count of matching entities, no rows or chips', async () => {
    const el = await mount(editor('element_list', { type: 'code-snippet', slugs: 'a,b,c' }));
    // a and b exist, c does not → 2 matching entities.
    expectOneInfoBlock(el, 'code-snippet', '2 matching entities');
    // One "read by slugs" for the whole list.
    expect(getBySlugs).toHaveBeenCalledTimes(1);
    expect(getBySlugs).toHaveBeenCalledWith('code-snippet', ['a', 'b', 'c']);
  });

  it('[ac:ac-element-list-albo-tagged-list-na-typ] editor: tagged_list on a type without renderRow is one block with the count of entities carrying the tags — 0 included', async () => {
    let el = await mount(editor('tagged_list', { type: 'code-snippet', tags: 'x' }));
    expectOneInfoBlock(el, 'code-snippet', '3 matching entities');
    expect(listByTags).toHaveBeenCalledWith({ tags: ['x'], filter: 'and' });

    el = await mount(editor('tagged_list', { type: 'code-snippet', tags: 'nothing-here' }));
    expectOneInfoBlock(el, 'code-snippet', '0 matching entities');
  });

  it('[ac:ac-element-list-albo-tagged-list-na-typ] chat: XmlChipDispatcher renders the same single block (inline) for element_list and tagged_list, no chips and no pill', async () => {
    let el = await mount(chat('element_list', { type: 'code-snippet', slugs: 'a,c' }));
    expectOneInfoBlock(el, 'code-snippet', '1 matching entity');
    expect(el.querySelector('span[data-no-list-view]')).not.toBeNull();

    el = await mount(chat('tagged_list', { type: 'code-snippet', tags: 'x' }));
    expectOneInfoBlock(el, 'code-snippet', '3 matching entities');
    // Not the `#tags · type` pill of a listable type.
    expect(el.textContent).not.toContain('#');
  });

  it('[ac:ac-element-list-albo-tagged-list-na-typ] only an ACTIVE type without renderRow: a listable type draws rows, an inactive one a broken chip — never the block', async () => {
    let el = await mount(editor('element_list', { type: 'endpoint', slugs: 'a,b' }));
    expect(el.querySelectorAll('[data-no-list-view]')).toHaveLength(0);
    expect(el.querySelectorAll('[data-row]')).toHaveLength(2);
    expect(getBySlugs).not.toHaveBeenCalled();

    el = await mount(editor('tagged_list', { type: 'retired-type', tags: 'x' }));
    expect(el.querySelectorAll('[data-no-list-view]')).toHaveLength(0);
    expect(el.querySelector('[data-broken-category="inactive-plugin"]')).not.toBeNull();
    expect(listByTags).not.toHaveBeenCalled();
  });
});
