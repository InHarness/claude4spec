// @vitest-environment happy-dom
/**
 * 2.1.16 — the `endpoint` type's own detail, history and list screens (M13
 * detail pattern, M19 list pattern, L12 Host UI Kit).
 *
 *  - `endpoint-detail` (`/endpoints/:slug`): the route renders breadcrumb
 *    (ending with method + path) + view switcher + Delete (host confirmation
 *    window `endpoint-delete`), no Edit button; header = method
 *    `EnumBadgePicker` + path field, no title field; summary text field;
 *    description `DocEditor`; tags a `collapsed` `TagPicker` whose new name goes
 *    to the entity's draft (no shared `TagCreatePopover`); "Find references".
 *  - `endpoint-history` (`/endpoints/:slug/history`): the kit's
 *    `EntityVersionHistoryView` with only type + slug; state `empty` for an
 *    entity with no versions or a deleted one (no tombstone).
 *  - `endpoint-list` (`/endpoints`): `EntityListHeader` inside
 *    `EntityListLayout`; row = method chip (leading), path (main), summary or
 *    "— no summary —" (second line), slug (trailing); states `loading` and
 *    `empty` (one `EmptyState` for "no endpoints" and "no match").
 *
 * The kit components are the host's real ones (`src/client/host-ui-kit/**`);
 * only the data hooks, the router and the live plugin host are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type FC, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Endpoint } from '../../src/types.js';

const state = vi.hoisted(() => ({
  endpoint: null as unknown,
  endpoints: [] as unknown[],
  endpointsLoading: false,
  params: { slug: 'get-api-users' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  updates: [] as Array<{ slug: string; input: Record<string, unknown> }>,
  deleted: [] as string[],
  modules: [] as Array<Record<string, unknown>>,
  tagPickers: [] as Array<{ variant?: string; onCreate?: (name: string) => void; selected: string[] }>,
  enumPickers: [] as Array<{ value: string; options: Array<{ value: string }> }>,
  docEditors: 0,
  headers: [] as Array<{ count?: number; title: string; search?: string }>,
  emptyStates: [] as Array<{ title: string; hint?: unknown; action?: unknown }>,
  loadingStates: 0,
  historyViews: [] as Array<Record<string, unknown>>,
  versions: { data: [] as unknown[], isLoading: false, isError: false, error: undefined as unknown },
  confirms: [] as Array<{ kind: string; title: string; body: string }>,
  relationPickers: [] as Array<{ groups: Array<{ key: string; label: string }> }>,
  badges: [] as Array<{ label: unknown; mono?: boolean }>,
}));

vi.mock('@tanstack/react-router', () => ({
  // The fragment hands back its route options, so the test can read path + component.
  createRoute: (opts: unknown) => opts,
  useParams: () => state.params,
  useSearch: () => state.search,
  useNavigate: () => (opts: unknown) => {
    state.navigate.push(opts);
  },
}));

vi.mock('@c4s/plugin-runtime', async () => {
  // 2.1.20 (M50 `tbeatf5z`): the plugin opens windows and toasts through the
  // shell facades of `@c4s/plugin-runtime` — the host's own functions, so the
  // real ones stand in here and the window they open is observed on the host side.
  const host = await import('../../../../src/client/ui/events.js');
  return {
    openPopover: host.openPopover,
    openModal: host.openModal,
    confirmDestructive: host.confirmDestructive,
    toast: host.toast,
    clientPluginHost: {
      listEntities: () => state.modules,
      getAvailable: (type: string) => state.modules.find((m) => m.type === type) ?? null,
      getEntity: (type: string) => state.modules.find((m) => m.type === type) ?? null,
      onRegistryChanged: () => () => undefined,
      registryVersion: () => 1,
    },
    useTags: () => ({ data: [] }),
    useReferences: () => ({ data: [] }),
    EditorBridgeProvider: ({ children }: { children: ReactNode }) => children,
    queryClient: null,
  };
});

// The history block's L11 hooks — the block itself is the kit's real one.
vi.mock('../../../../src/client/hooks/useVersions.js', () => ({
  useVersions: () => state.versions,
  useVersionDetail: () => ({ data: undefined }),
  useRestoreVersion: () => ({ isPending: false, isError: false, error: null, mutate: () => {} }),
}));
vi.mock('../../../../src/client/hooks/useReleases.js', () => ({
  useReleases: () => new Map<number, string>(),
}));

vi.mock('@c4s/plugin-runtime/ui', async () => {
  const { createElement: h } = await import('react');
  const [
    tagMod,
    badgeMod,
    rowMod,
    gridMod,
    btnMod,
    hdrMod,
    layoutMod,
    emptyMod,
    loadMod,
    listRowMod,
    tagBarMod,
    popMod,
    enumMod,
    relMod,
    histMod,
    tagChipMod,
  ] = await Promise.all([
    import('../../../../src/client/host-ui-kit/detail/TagPicker.js'),
    import('../../../../src/client/host-ui-kit/actions/Badge.js'),
    import('../../../../src/client/host-ui-kit/core/FieldRow.js'),
    import('../../../../src/client/host-ui-kit/core/FieldGrid.js'),
    import('../../../../src/client/host-ui-kit/actions/ActionButton.js'),
    import('../../../../src/client/host-ui-kit/core/EntityListHeader.js'),
    import('../../../../src/client/host-ui-kit/list/EntityListLayout.js'),
    import('../../../../src/client/host-ui-kit/list/EmptyState.js'),
    import('../../../../src/client/host-ui-kit/actions/LoadingState.js'),
    import('../../../../src/client/host-ui-kit/list/EntityListRow.js'),
    import('../../../../src/client/host-ui-kit/list/TagFilterBar.js'),
    import('../../../../src/client/host-ui-kit/overlay-feedback/Popover.js'),
    import('../../../../src/client/host-ui-kit/pickers/EnumBadgePicker.js'),
    import('../../../../src/client/host-ui-kit/pickers/GroupedRelationPicker.js'),
    import('../../../../src/client/host-ui-kit/detail/EntityVersionHistoryView.js'),
    import('../../../../src/client/host-ui-kit/actions/TagChip.js'),
  ]);
  const spy =
    <P,>(Real: FC<P>, sink: (p: P) => void): FC<P> =>
    (p: P) => {
      sink(p);
      return h(Real as FC<P>, p as never);
    };
  const Passthrough = ({ children }: { children?: ReactNode }) => h('div', null, children);
  return {
    TagPicker: spy(tagMod.TagPicker, (p) => state.tagPickers.push(p as never)),
    Badge: spy(badgeMod.Badge, (p) => { if (p) state.badges.push(p as never); }),
    TagChip: tagChipMod.TagChip,
    FieldRow: rowMod.FieldRow,
    FieldGrid: gridMod.FieldGrid,
    ActionButton: btnMod.ActionButton,
    EntityListHeader: spy(hdrMod.EntityListHeader, (p) => state.headers.push(p as never)),
    EntityListLayout: layoutMod.EntityListLayout,
    // Spied on the plugin surface only — the history block imports its own.
    EmptyState: spy(emptyMod.EmptyState, (p) => state.emptyStates.push(p as never)),
    LoadingState: spy(loadMod.LoadingState, () => {
      state.loadingStates += 1;
    }),
    EntityListRow: listRowMod.EntityListRow,
    TagFilterBar: tagBarMod.TagFilterBar,
    Popover: popMod.Popover,
    EnumBadgePicker: spy(enumMod.EnumBadgePicker, (p) => state.enumPickers.push(p as never)),
    GroupedRelationPicker: spy(relMod.GroupedRelationPicker, (p) => { if (p) state.relationPickers.push(p as never); }),
    EntityVersionHistoryView: spy(histMod.EntityVersionHistoryView, (p) =>
      state.historyViews.push(p as never),
    ),
    // The description editor: a plain textarea stands in for the ProseMirror one.
    DocEditor: ({ value }: { value: string }) => {
      state.docEditors += 1;
      return h('textarea', { 'aria-label': 'Description', defaultValue: value });
    },
    Dialog: Passthrough,
    FormShell: Passthrough,
    FormField: Passthrough,
  };
});

vi.mock('../../src/entity/dto/frontend/hooks.js', () => ({
  useDtos: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../src/entity/endpoint/frontend/hooks.js', () => ({
  useEndpoint: () => ({ data: state.endpoint ?? undefined, isLoading: false, error: null }),
  useEndpoints: () => ({
    data: state.endpointsLoading ? undefined : state.endpoints,
    isLoading: state.endpointsLoading,
  }),
  useUpdateEndpoint: () => ({
    isPending: false,
    mutateAsync: async ({ slug, input }: { slug: string; input: Record<string, unknown> }) => {
      state.updates.push({ slug, input });
      return { ...(state.endpoint as object), ...input };
    },
  }),
  useDeleteEndpoint: () => ({
    isPending: false,
    mutateAsync: async (slug: string) => {
      state.deleted.push(slug);
      return { deleted: true };
    },
  }),
  useLinkDto: () => ({ mutate: () => undefined }),
  useUnlinkDto: () => ({ mutate: () => undefined }),
  useCreateEndpoint: () => ({ isPending: false, mutateAsync: async () => state.endpoint }),
}));

import { endpointRoutes } from '../../src/entity/endpoint/frontend/routes.js';
import {
  EndpointsList,
  ENDPOINT_LIST_EMPTY_TITLE,
  ENDPOINT_NO_SUMMARY,
} from '../../src/entity/endpoint/frontend/list-page.js';
import { endpointFrontendModule } from '../../src/entity/endpoint/frontend/module.js';
import { deleteEndpointBody } from '../../src/entity/endpoint/frontend/delete-confirm.js';
import { ApiError } from '../../../../src/client/lib/api-core.js';
import { EndpointDetail } from '../../src/entity/endpoint/frontend/detail-panel.js';
import { checkSlotShapes } from '../../../../src/client/core/plugin-host/slot-rules.js';

const REPO = join(import.meta.dirname, '../../../..');
const FRONTEND_SRC = join(import.meta.dirname, '../../src/entity/endpoint/frontend');
const detailSrc = readFileSync(join(FRONTEND_SRC, 'detail-panel.tsx'), 'utf-8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleEndpoint(over: Partial<Endpoint> = {}): Endpoint {
  return {
    slug: 'get-api-users',
    title: 'GET /api/users',
    method: 'GET',
    path: '/api/users',
    summary: 'List users',
    description: 'Returns every user.',
    tags: [],
    linkedDtos: [],
    createdAt: '2026-10-10 10:00:00',
    updatedAt: '2026-10-10 10:00:00',
    ...over,
  };
}

function mod(type: string, label: string, labelPlural: string, pathPrefix: string) {
  return { type, label, labelPlural, pathPrefix };
}

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  state.relationPickers = [];
  state.badges = [];
  state.endpoint = sampleEndpoint();
  state.endpoints = [];
  state.endpointsLoading = false;
  state.params = { slug: 'get-api-users' };
  state.search = {};
  state.navigate = [];
  state.updates = [];
  state.deleted = [];
  state.modules = [mod('endpoint', 'Endpoint', 'Endpoints', '/endpoints'), mod('dto', 'DTO', 'DTOs', '/dtos')];
  state.tagPickers = [];
  state.enumPickers = [];
  state.docEditors = 0;
  state.headers = [];
  state.emptyStates = [];
  state.loadingStates = 0;
  state.historyViews = [];
  state.versions = { data: [], isLoading: false, isError: false, error: undefined };
  state.confirms = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, node));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function routeTable() {
  const routes = endpointRoutes({ rootRoute: {} } as never) as unknown as Array<{
    path: string;
    component: FC;
  }>;
  return new Map(routes.map((r) => [r.path, r]));
}

function buttonByText(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

function listProps(over: Partial<Parameters<typeof EndpointsList>[0]> = {}) {
  return {
    search: '',
    tagFilter: [] as string[],
    onSearchChange: () => undefined,
    onTagToggle: () => undefined,
    onSelect: () => undefined,
    ...over,
  };
}

/** The kit `EntityListRow` of a rendered list: a button per endpoint. */
function rowFor(slug: string): HTMLButtonElement {
  const row = Array.from(container.querySelectorAll('button')).find(
    (b) => b.lastElementChild?.textContent === slug,
  ) as HTMLButtonElement | undefined;
  if (!row) throw new Error(`no row for ${slug}`);
  return row;
}

describe('[entity:endpoint-detail] /endpoints/:slug', () => {
  it('[entity:endpoint-detail] is registered under /endpoints/$slug and renders breadcrumb (method + path), view switcher, Delete — no Edit, no title field', async () => {
    const routes = routeTable();
    // url `/endpoints/:slug` — TanStack spells the path param `$slug`.
    const detail = routes.get('/endpoints/$slug');
    expect(detail).toBeDefined();

    await render(createElement(detail!.component));

    const text = container.textContent ?? '';
    // Breadcrumb: list label, then the endpoint's method and path.
    const crumbs = buttonByText('Endpoints', container);
    expect(crumbs).toBeDefined();
    const bar = crumbs!.parentElement!;
    expect(bar.textContent).toMatch(/Endpoints.*GET.*\/api\/users$/);
    // View switcher (details / history).
    expect(buttonByText('Details', container)).toBeDefined();
    expect(buttonByText('History', container)).toBeDefined();
    // Delete on the route's toolbar — exactly one; no Edit button anywhere.
    expect(
      Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Delete'),
    ).toHaveLength(1);
    expect(buttonByText('Edit', container)).toBeUndefined();
    // Header: method as `EnumBadgePicker` over the HTTP palette + the path field.
    const picker = state.enumPickers.at(-1)!;
    expect(picker.value).toBe('GET');
    expect(picker.options.map((o) => o.value)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.some((i) => i.value === '/api/users')).toBe(true);
    // No title field on the detail.
    expect(inputs.some((i) => i.value === 'GET /api/users')).toBe(false);
    // Summary: a plain text field.
    expect(inputs.some((i) => i.value === 'List users')).toBe(true);
    // Description: `DocEditor`.
    expect(state.docEditors).toBeGreaterThan(0);
    expect((container.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement).value).toBe(
      'Returns every user.',
    );
    // Tags: `TagPicker` in the `collapsed` variant.
    expect(state.tagPickers.at(-1)?.variant).toBe('collapsed');
    // Find references — no citations.
    expect(text).toContain('Find references');
    expect(text).toContain('Not referenced by any page.');
  });

  it('[entity:endpoint-detail] Delete asks through the host confirmation window (endpoint-delete), then goes to the list', async () => {
    const onConfirm = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; title: string; body: string; onConfirm: () => void };
      state.confirms.push(d);
      d.onConfirm();
    };
    window.addEventListener('c4s:confirm-open', onConfirm);
    try {
      await render(createElement(routeTable().get('/endpoints/$slug')!.component));
      await act(async () => {
        buttonByText('Delete', container)!.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(state.confirms).toHaveLength(1);
      expect(state.confirms[0]!.kind).toBe('endpoint-delete');
      expect(state.confirms[0]!.title).toBe('Delete endpoint?');
      expect(state.confirms[0]!.body).toBe(deleteEndpointBody('GET /api/users'));
      expect(state.deleted).toEqual(['get-api-users']);
      expect(state.navigate.at(-1)).toMatchObject({ to: '/endpoints' });
    } finally {
      window.removeEventListener('c4s:confirm-open', onConfirm);
    }
  });

  it('[entity:endpoint-detail] a new tag name goes to the entity draft and is sent with the entity save — no tag created up front, no TagCreatePopover', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await render(createElement(routeTable().get('/endpoints/$slug')!.component));
      const picker = state.tagPickers.at(-1)!;
      expect(picker.onCreate).toBeTypeOf('function');
      await act(async () => {
        picker.onCreate!('Auth Layer');
      });
      expect(state.tagPickers.at(-1)!.selected).toContain('auth-layer');
      // Autosave (debounced) carries the new tag with the entity.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 700));
      });
      expect(state.updates.at(-1)?.slug).toBe('get-api-users');
      expect(state.updates.at(-1)?.input.tags).toEqual(['auth-layer']);
      const tagPosts = fetchSpy.mock.calls.filter(
        ([url, init]) => String(url).includes('/tags') && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(tagPosts).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(detailSrc).not.toMatch(/TagCreatePopover/);
    // The shared create-tag popover is gone from the host altogether.
    expect(existsSync(join(REPO, 'src/client/ui/popovers/CreateTagForm.tsx'))).toBe(false);
    expect(readFileSync(join(REPO, 'src/client/ui/popovers/registry.ts'), 'utf-8')).not.toMatch(/create-tag/);
    expect(readFileSync(join(REPO, 'src/client/ui/events.ts'), 'utf-8')).not.toMatch(/'create-tag'/);
  });

  it('[entity:endpoint-detail] the sidebar tab carries no emptyState', () => {
    expect(endpointFrontendModule.sidebarTab).toBeDefined();
    expect(endpointFrontendModule.sidebarTab!.label).toBe('Endpoints');
    expect('emptyState' in endpointFrontendModule.sidebarTab!).toBe(false);
  });
});

describe('[entity:endpoint-history] /endpoints/:slug/history', () => {
  it('[entity:endpoint-history] is registered under /endpoints/$slug/history and renders EntityVersionHistoryView with only type and slug', async () => {
    const history = routeTable().get('/endpoints/$slug/history');
    expect(history).toBeDefined();
    state.versions = {
      data: [{ version: 1, changedBy: 'user', changeSummary: 'created', createdAt: '2026-10-10T10:00:00Z' }],
      isLoading: false,
      isError: false,
      error: undefined,
    };
    await render(createElement(history!.component));

    expect(state.historyViews.at(-1)).toEqual({ type: 'endpoint', slug: 'get-api-users' });
    // Breadcrumb + view switcher, History is the active view.
    expect(buttonByText('Endpoints', container)).toBeDefined();
    expect(buttonByText('Details', container)).toBeDefined();
    // The timeline with the Diff / Snapshot tabs.
    expect(container.textContent).toContain('v1');
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(['Diff', 'Snapshot']);
    // No Edit on the history view either.
    expect(buttonByText('Edit', container)).toBeUndefined();
  });

  it('[entity:endpoint-history] state empty — an entity with no versions shows the empty history', async () => {
    state.versions = { data: [], isLoading: false, isError: false, error: undefined };
    await render(createElement(routeTable().get('/endpoints/$slug/history')!.component));
    expect(container.textContent).toContain('No versions yet');
  });

  it('[entity:endpoint-history] state empty — a deleted entity (404) shows the same empty history, no tombstone', async () => {
    state.endpoint = null;
    state.versions = {
      data: undefined as unknown as unknown[],
      isLoading: false,
      isError: true,
      error: new ApiError('NOT_FOUND', 'Entity not found', 404),
    };
    await render(createElement(routeTable().get('/endpoints/$slug/history')!.component));
    expect(container.textContent).toContain('No versions yet');
    expect(container.textContent).not.toMatch(/Deleted|Restore/);
  });
});

describe('[entity:endpoint-detail] 2.1.28 composition', () => {
  it('[entity:endpoint-detail] Linked DTOs is a kit GroupedRelationPicker with one group per relation (request / response / error)', async () => {
    await render(createElement(routeTable().get('/endpoints/$slug')!.component));
    expect(state.relationPickers.length).toBeGreaterThan(0);
    expect(state.relationPickers.at(-1)!.groups.map((g) => g.key)).toEqual(['request', 'response', 'error']);
  });
});

describe('[entity:endpoint-list] /endpoints', () => {
  it('[entity:endpoint-list] 2.1.28 composition — the row\'s leading method chip is a kit Badge', async () => {
    state.endpoints = [sampleEndpoint()];
    await render(createElement(routeTable().get('/endpoints')!.component));
    const method = state.badges.find((b) => b.label === 'GET');
    expect(method).toBeDefined();
    expect(method!.mono).toBe(true);
  });

  it('[entity:endpoint-list] is registered under /endpoints and renders EntityListHeader (title, count, search, New endpoint) with rows', async () => {
    const list = routeTable().get('/endpoints');
    expect(list).toBeDefined();
    state.endpoints = [
      sampleEndpoint(),
      sampleEndpoint({ slug: 'post-api-orders', title: 'POST /api/orders', method: 'POST', path: '/api/orders', summary: '' }),
    ];
    await render(createElement(list!.component));

    const header = state.headers.at(-1)!;
    expect(header.title).toBe('Endpoints');
    // Count = length of the fetched list.
    expect(header.count).toBe(2);
    expect(container.textContent).toContain('2 results');
    expect(header.search).toBe('');
    expect(container.querySelector('input[placeholder^="Search"]')).not.toBeNull();
    expect(buttonByText('New endpoint', container)).toBeDefined();
    // Second line: summary, or "— no summary —".
    expect(rowFor('get-api-users').textContent).toContain('List users');
    expect(rowFor('post-api-orders').textContent).toContain(ENDPOINT_NO_SUMMARY);
    // No pagination, no error state.
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Page \d+ of/);
    expect(state.loadingStates).toBe(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:endpoint-list] state loading — a LoadingState stands in for the rows', async () => {
    state.endpointsLoading = true;
    await render(createElement(routeTable().get('/endpoints')!.component));
    expect(state.loadingStates).toBeGreaterThan(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:endpoint-list] state empty — one EmptyState with the type text and no filter reset', async () => {
    await render(createElement(EndpointsList, listProps()));
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe(ENDPOINT_LIST_EMPTY_TITLE);
    expect(empty.action).toBeUndefined();
    expect(container.textContent).not.toMatch(/clear filters|reset|Create your first endpoint/i);
  });
});

describe('endpoint-list criteria', () => {
  it('[ac:ac-wiersz-listy-endpointow-pokazuje-meto] the row shows the HTTP method as a chip at the start of the row, before the path', async () => {
    state.endpoints = [sampleEndpoint({ slug: 'patch-api-users-id', method: 'PATCH', path: '/api/users/:id' })];
    await render(createElement(EndpointsList, listProps()));

    const row = rowFor('patch-api-users-id');
    const chip = row.firstElementChild as HTMLElement;
    // The first thing in the row is the method chip (a kit `Badge`), not the path.
    expect(chip.textContent).toBe('PATCH');
    expect(chip.textContent).not.toContain('/api/users/:id');
    // …and it comes before the path in document order.
    const pathEl = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === '/api/users/:id')!;
    expect(pathEl).toBeDefined();
    expect(chip.compareDocumentPosition(pathEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.textContent!.indexOf('PATCH')).toBeLessThan(row.textContent!.indexOf('/api/users/:id'));
  });

  it('[ac:ac-wiersz-listy-endpointow-pokazuje-path] the row shows the endpoint path as its main content', async () => {
    state.endpoints = [sampleEndpoint({ slug: 'get-api-orders', path: '/api/orders', summary: 'Orders' })];
    await render(createElement(EndpointsList, listProps()));

    const row = rowFor('get-api-orders');
    // The main content column (between the leading chip and the trailing slug).
    const main = Array.from(row.children).find((c) => c.classList.contains('flex-1')) as HTMLElement;
    expect(main).toBeDefined();
    // Its first line is the path — the slug and the title are not the main content.
    expect(main.firstElementChild!.textContent).toBe('/api/orders');
    expect(main.textContent).not.toContain('get-api-orders');
    // The summary sits on the second line, under the path.
    expect((main.children[1] as HTMLElement).textContent).toBe('Orders');
    // The slug is at the end of the row.
    expect(row.lastElementChild!.textContent).toBe('get-api-orders');
  });

  it('[ac:ac-lista-endpointow-bez-zadnej-encji-i-l] no endpoints at all and no endpoint matching the filter show the same empty state', async () => {
    // A project with no endpoint.
    state.endpoints = [];
    await render(createElement(EndpointsList, listProps()));
    const none = state.emptyStates.at(-1)!;
    const noneMarkup = emptyMarkup();

    // A search + tag filter that matches nothing.
    state.emptyStates = [];
    await render(createElement(EndpointsList, listProps({ search: 'no-such-endpoint', tagFilter: ['auth'] })));
    const noMatch = state.emptyStates.at(-1)!;

    expect(none.title).toBe(ENDPOINT_LIST_EMPTY_TITLE);
    expect(noMatch).toEqual(none);
    expect(emptyMarkup()).toBe(noneMarkup);
    expect(container.textContent).not.toMatch(/match your filters|Create your first endpoint/i);
  });
});

describe('[section:109mdc2m] manifest renderRow (element_list / tagged_list row)', () => {
  type RowFC = FC<{
    entity: Endpoint;
    active?: boolean;
    onOpen: () => void;
    tagLookup: ReadonlyMap<string, { slug: string; name: string; color?: string | null }>;
  }>;
  const Row = endpointFrontendModule.renderRow as unknown as RowFC;
  const NO_TAGS = new Map();

  it('[section:109mdc2m] the manifest row shows method chip, path as main content, summary on the second line and the slug at the end', async () => {
    await render(
      createElement(Row, {
        entity: sampleEndpoint({ slug: 'get-api-orders', path: '/api/orders', summary: 'Orders' }),
        onOpen: () => undefined,
        tagLookup: NO_TAGS,
      }),
    );
    const row = container.querySelector('button')!;
    expect(row).toBeTruthy();
    // Leading: the method chip.
    expect((row.firstElementChild as HTMLElement).textContent).toBe('GET');
    // Main content: path, then summary on the second line.
    const main = row.children[1] as HTMLElement;
    expect((main.children[0] as HTMLElement).textContent).toBe('/api/orders');
    expect((main.children[1] as HTMLElement).textContent).toBe('Orders');
    expect(main.textContent).not.toContain('get-api-orders');
    // Trailing: the slug is the last thing in the row.
    expect(row.lastElementChild!.textContent).toBe('get-api-orders');
  });

  it('[section:109mdc2m] the manifest row of an endpoint without summary shows "— no summary —" on the second line', async () => {
    await render(
      createElement(Row, {
        entity: sampleEndpoint({ slug: 'delete-api-users-id', method: 'DELETE', path: '/api/users/:id', summary: '' }),
        onOpen: () => undefined,
        tagLookup: NO_TAGS,
      }),
    );
    const row = container.querySelector('button')!;
    const main = row.children[1] as HTMLElement;
    expect((main.children[0] as HTMLElement).textContent).toBe('/api/users/:id');
    expect((main.children[1] as HTMLElement).textContent).toBe(ENDPOINT_NO_SUMMARY);
    expect(ENDPOINT_NO_SUMMARY).toBe('— no summary —');
    expect(row.lastElementChild!.textContent).toBe('delete-api-users-id');
  });

  it('[section:109mdc2m] 2.1.40: the row shows the record tags as TagChips coloured from the slot tagLookup, before the slug; the method is a Badge with no fill', async () => {
    const lookup = new Map([['auth', { slug: 'auth', name: 'Auth', color: 'rgb(51, 102, 153)' }]]);
    await render(
      createElement(Row, {
        entity: sampleEndpoint({ slug: 'get-api-orders', path: '/api/orders', tags: ['auth', 'ghost'] }),
        onOpen: () => undefined,
        tagLookup: lookup,
      }),
    );
    const row = container.querySelector('button')!;
    const chips = Array.from(row.querySelectorAll<HTMLElement>('.tag-chip'));
    // Every tag of the record; one missing from the map shows its slug.
    expect(chips.map((c) => c.textContent)).toEqual(['Auth', 'ghost']);
    // The dot takes the project colour from the lookup.
    expect((chips[0]!.firstElementChild as HTMLElement).style.background).toBe('rgb(51, 102, 153)');
    // Tags sit before the slug, which stays last.
    expect(row.lastElementChild!.textContent).toBe('get-api-orders');
    // The method marker is a value `Badge` — `value-badge`, ink only.
    const method = row.firstElementChild as HTMLElement;
    expect(method.className).toContain('value-badge');
    expect(method.style.color).not.toBe('');
  });
});

/** The markup of the list body that stands where the rows would. */
function emptyMarkup(): string {
  const title = Array.from(container.querySelectorAll('*')).find(
    (n) => n.children.length === 0 && n.textContent === ENDPOINT_LIST_EMPTY_TITLE,
  );
  if (!title) throw new Error('no empty state rendered');
  // The EmptyState block: climb to the element holding the title and its hint.
  let el = title as Element;
  while (el.parentElement && el.parentElement.textContent === el.textContent) el = el.parentElement;
  return el.outerHTML;
}

// ─── 2.1.19 ───────────────────────────────────────────────────────────────

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const el = Array.from(container.querySelectorAll('input')).find((i) => i.placeholder === placeholder);
  if (!el) throw new Error(`no input with placeholder ${placeholder}`);
  return el as HTMLInputElement;
}

describe('endpoint-detail criteria (2.1.19)', () => {
  it('[ac:ac-pole-detalu-endpointu-edytowane-lokal] a field edited locally keeps the value the user typed when the endpoint changes from outside', async () => {
    const Detail = routeTable().get('/endpoints/$slug')!.component;
    await render(createElement(Detail));
    expect(inputByPlaceholder('Short summary…').value).toBe('List users');

    // The user edits the summary; the debounced save (500 ms) has not run yet.
    await typeInto(inputByPlaceholder('Short summary…'), 'Lists every active user');

    // Meanwhile the endpoint changes from outside (another client / the agent):
    // the host's live update refetches it and the detail re-renders with it.
    state.endpoint = sampleEndpoint({ path: '/api/people', updatedAt: '2026-10-10 11:00:00' });
    await render(createElement(Detail));

    // The locally edited field keeps what the user typed …
    expect(inputByPlaceholder('Short summary…').value).toBe('Lists every active user');
    // … while the field the user did not touch takes the external value.
    expect(inputByPlaceholder('/api/...').value).toBe('/api/people');

    // The save that follows keeps the user's value and does not write the old
    // server path back over the external change.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.input).toMatchObject({
      method: 'GET',
      path: '/api/people',
      summary: 'Lists every active user',
    });
    expect(inputByPlaceholder('Short summary…').value).toBe('Lists every active user');
  });
});

// ─── 2.1.19 — L11 manifest slot and L12 slice of the endpoint type ────────

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function consumedCatalog(files: string[]): Set<string> {
  const consumed = new Set<string>();
  for (const p of files) {
    const src = readFileSync(p, 'utf-8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@c4s\/plugin-runtime\/ui'/g)) {
      for (const name of m[1]!.split(',')) {
        const n = name.trim();
        if (!n || n.startsWith('type ')) continue;
        consumed.add(n);
      }
    }
  }
  return consumed;
}

const KIT_SRC = join(import.meta.dirname, '../../src/frontend-kit');

describe('[section:vc5pzsc0] endpoint manifest detailPanel slot — checked for shape, not rendered by the host', () => {
  it('[section:vc5pzsc0] the manifest declares detailPanel: EndpointDetail next to routes, and the host slot check accepts it', () => {
    expect(endpointFrontendModule.detailPanel).toBe(EndpointDetail);
    expect(typeof endpointFrontendModule.routes).toBe('function');
    expect(checkSlotShapes(endpointFrontendModule)).toBeNull();
    expect(checkSlotShapes({ ...endpointFrontendModule, detailPanel: {} as never })).toMatch(
      /'detailPanel' is declared but is not a React component/,
    );
  });

  it('[section:vc5pzsc0] the /endpoints/$slug route renders EndpointDetail itself', async () => {
    expect(readFileSync(join(FRONTEND_SRC, 'routes.tsx'), 'utf-8')).toMatch(/<EndpointDetail\b/);
    await render(createElement(routeTable().get('/endpoints/$slug')!.component));
    expect(inputByPlaceholder('/api/...').value).toBe('/api/users');
  });
});

describe('[section:dhh869qt] endpoint Host UI Kit slice', () => {
  it('[section:dhh869qt] the endpoint screens consume exactly the catalog components the slice lists — DocEditor among them; Pagination, DetailPanelShell, EntityDetailToolbar, SegmentedControlTabs, InlineEditField and Popover not', () => {
    const consumed = consumedCatalog([...sourceFiles(FRONTEND_SRC), ...sourceFiles(KIT_SRC)]);
    expect([...consumed].sort()).toEqual(
      [
        'EntityListLayout',
        'EntityListHeader',
        'EntityListRow',
        'TagFilterBar',
        'LoadingState',
        'EmptyState',
        'Badge',
        'FieldGrid',
        'FieldRow',
        'EnumBadgePicker',
        'GroupedRelationPicker',
        'TagPicker',
        'DocEditor',
        'EntityVersionHistoryView',
        'Dialog',
        'FormShell',
        'FormField',
        'ActionButton',
      ].sort(),
    );
    for (const dropped of ['Pagination', 'DetailPanelShell', 'EntityDetailToolbar', 'SegmentedControlTabs', 'InlineEditField', 'Popover']) {
      expect(consumed.has(dropped), dropped).toBe(false);
    }
  });

  it('[section:dhh869qt] each host-local frontend-kit duplicate is recorded as DEBT naming its catalog replacement', () => {
    const debt: Array<[file: string, exports: string[], replacement: string | null]> = [
      ['EntityBreadcrumbBar.tsx', ['EntityBreadcrumbBar'], 'DetailPanelShell'],
      ['EntityViewSwitcher.tsx', ['EntityViewSwitcher'], 'SegmentedControlTabs'],
      ['SegmentedControl.tsx', ['SegmentedControl'], 'SegmentedControlTabs'],
      ['ButtonGroup.tsx', ['ButtonGroup', 'SegmentButton'], 'SegmentedControlTabs'],
      ['popover-form.tsx', ['FieldLabel', 'TextInput', 'SelectInput', 'InlineError', 'PopoverFooter'], 'FormField'],
      ['ListPageLayout.tsx', ['ListPageLayout'], null],
      // `RoutePane` — the package's copy of the host's route pane, exported as `Pane`.
      ['route-shell.tsx', ['Pane'], null],
    ];
    for (const [file, exports, replacement] of debt) {
      const src = readFileSync(join(KIT_SRC, file), 'utf-8');
      for (const name of exports) {
        expect(src, `${file} exports ${name}`).toMatch(new RegExp(`export (function|const) ${name}\\b`));
      }
      const header = src.match(/DEBT \(2\.1\.(?:19|20)[^]*?Recorded, not fixed here/)?.[0];
      expect(header, `${file} DEBT header`).toBeDefined();
      // 2.1.20: `ListPageLayout` and `RoutePane` have no catalog replacement — trajectory candidates.
      if (replacement === null) expect(header!).toContain('candidate of the catalog trajectory');
      else expect(header!).toContain(`\`${replacement}\``);
    }
    // Recorded, not fixed: the endpoint routes still use the local bar.
    expect(readFileSync(join(FRONTEND_SRC, 'routes.tsx'), 'utf-8')).toMatch(/<EntityBreadcrumbBar\b/);
    // 2.1.20: `MethodChip` is struck from the debts — the list row and the
    // breadcrumb draw the method through it, and it only binds the catalog Badge.
    expect(readFileSync(join(FRONTEND_SRC, 'list-page.tsx'), 'utf-8')).toMatch(/<MethodChip\b/);
    expect(readFileSync(join(KIT_SRC, 'EntityBreadcrumbBar.tsx'), 'utf-8')).toMatch(/<MethodChip\b/);
    const atoms = readFileSync(join(KIT_SRC, 'atoms.tsx'), 'utf-8');
    // 2.1.39: the file carries no debt any more (the local TagChip is gone).
    expect(atoms).not.toMatch(/DEBT \(/);
    expect(atoms).not.toMatch(/export function TagChip\b/);
    expect(atoms).toMatch(/export function MethodChip[\s\S]*?<Badge\b/);
  });

  it('[section:dhh869qt] ListPageHeader / ListScrollArea (struck from the slice in 2.1.20) are not carried by this package — the endpoint list composes their replacements directly', () => {
    const kit = readdirSync(KIT_SRC);
    expect(kit).not.toContain('ListPageHeader.tsx');
    expect(kit).not.toContain('ListScrollArea.tsx');
    const list = readFileSync(join(FRONTEND_SRC, 'list-page.tsx'), 'utf-8');
    for (const name of ['EntityListHeader', 'EntityListLayout', 'LoadingState', 'EmptyState']) {
      expect(list).toMatch(new RegExp(`<${name}\\b`));
    }
  });
});
