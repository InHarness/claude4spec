// @vitest-environment happy-dom
/**
 * 2.1.16 — the `ui-view` type's own detail and list screens (M13 detail pattern,
 * M19 list pattern, L12 Host UI Kit).
 *
 *  - `ui-view-detail` (`/ui-views/:slug`): the route renders breadcrumb + the
 *    three-tab switcher (catalog `SegmentedControlTabs`) + Delete (host
 *    confirmation window `ui-view-delete`), no Edit button; fields edit in
 *    place; Parameters is a grid in a `FieldRow` with a warning for path params
 *    the URL has and `params` lacks; "Find references" row; tags are a
 *    `collapsed` `TagPicker` whose new name goes to the entity draft (no
 *    `TagCreatePopover`).
 *  - `ui-view-list` (`/ui-views`): `EntityListHeader` (title, count, search,
 *    "New View") inside `EntityListLayout`, rows with the parameter count;
 *    states `loading` and `empty` (one `EmptyState`, no reset).
 *  - sidebar tab without `emptyState`; chip / card with their own deleted-entity
 *    branch, where the Alt gestures are off.
 *
 * The kit components are the host's real ones (`src/client/host-ui-kit/**`);
 * only the data hooks, the router and the live plugin host are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type FC, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UiView } from '../../src/types.js';

const state = vi.hoisted(() => ({
  view: null as unknown,
  views: [] as unknown[],
  viewsLoading: false,
  refs: [] as unknown[],
  params: { slug: 'user-profile' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  updates: [] as Array<{ slug: string; input: Record<string, unknown> }>,
  deleted: [] as string[],
  modules: [] as Array<Record<string, unknown>>,
  tagPickers: [] as Array<{ variant?: string; onCreate?: (name: string) => void; selected: string[] }>,
  headers: [] as Array<{ count?: number; title: string; search?: string }>,
  emptyStates: [] as Array<{ title: string; hint?: unknown; action?: unknown }>,
  loadingStates: 0,
  segmented: [] as Array<{ active: string; tabs: Array<{ id: string; label: string }> }>,
  confirms: [] as Array<{ kind: string; title: string; body: string }>,
  historyViews: [] as Array<Record<string, unknown>>,
  badges: [] as Array<{ label: unknown }>,
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
    useReferences: () => ({ data: state.refs }),
    // 2.1.41 — the detail panel resolves designSystemSlug through the host hook.
    useRefLookup: () => new Map(),
    EditorBridgeProvider: ({ children }: { children: ReactNode }) => children,
    queryClient: null,
  };
});

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
    segMod,
    relMod,
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
    import('../../../../src/client/host-ui-kit/detail/SegmentedControlTabs.js'),
    import('../../../../src/client/host-ui-kit/pickers/GroupedRelationPicker.js'),
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
    FieldRow: rowMod.FieldRow,
    FieldGrid: gridMod.FieldGrid,
    ActionButton: btnMod.ActionButton,
    EntityListHeader: spy(hdrMod.EntityListHeader, (p) => state.headers.push(p as never)),
    EntityListLayout: layoutMod.EntityListLayout,
    EmptyState: spy(emptyMod.EmptyState, (p) => state.emptyStates.push(p as never)),
    LoadingState: spy(loadMod.LoadingState, () => {
      state.loadingStates += 1;
    }),
    EntityListRow: listRowMod.EntityListRow,
    TagFilterBar: tagBarMod.TagFilterBar,
    Popover: popMod.Popover,
    SegmentedControlTabs: spy(segMod.SegmentedControlTabs, (p) => state.segmented.push(p as never)),
    GroupedRelationPicker: relMod.GroupedRelationPicker,
    // The description editor: a plain textarea stands in for the ProseMirror one.
    DocEditor: ({ value }: { value: string }) => h('textarea', { 'aria-label': 'Description', defaultValue: value }),
    // The host history block: records exactly the props the route hands it
    // (calls without props — React dev's component-stack call — are skipped).
    EntityVersionHistoryView: (p?: Record<string, unknown>) => {
      if (p) state.historyViews.push({ ...p });
      return h('div', { 'data-testid': 'entity-version-history-view' });
    },
    // Not rendered by these cases.
    Dialog: Passthrough,
    FormShell: Passthrough,
    FormField: Passthrough,
  };
});

vi.mock('../../src/entity/ui-view/frontend/hooks.js', () => ({
  useUiView: () => ({ data: state.view ?? undefined, isLoading: false, error: null }),
  useUiViews: () => ({
    data: state.viewsLoading ? undefined : state.views,
    isLoading: state.viewsLoading,
  }),
  useUpdateUiView: () => ({
    isPending: false,
    mutateAsync: async ({ slug, input }: { slug: string; input: Record<string, unknown> }) => {
      state.updates.push({ slug, input });
      return { ...(state.view as object), ...input };
    },
  }),
  useDeleteUiView: () => ({
    isPending: false,
    mutateAsync: async (slug: string) => {
      state.deleted.push(slug);
      return { deleted: true };
    },
  }),
  useCreateUiView: () => ({ isPending: false, mutateAsync: async () => state.view }),
}));

vi.mock('../../src/entity/design-system/frontend/hooks.js', () => ({
  useDesignSystems: () => ({ data: [] }),
  useDesignSystem: () => ({ data: undefined }),
}));

import { uiViewRoutes } from '../../src/entity/ui-view/frontend/routes.js';
import { UiViewsList, UI_VIEW_LIST_EMPTY_TITLE } from '../../src/entity/ui-view/frontend/list-page.js';
import { uiViewFrontendModule } from '../../src/entity/ui-view/frontend/module.js';
import { deleteUiViewBody } from '../../src/entity/ui-view/frontend/delete-confirm.js';

const FRONTEND_SRC = join(import.meta.dirname, '../../src/entity/ui-view/frontend');
const detailSrc = readFileSync(join(FRONTEND_SRC, 'detail-panel.tsx'), 'utf-8');
const switcherSrc = readFileSync(
  join(import.meta.dirname, '../../src/frontend-kit/EntityViewSwitcher.tsx'),
  'utf-8',
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleView(over: Partial<UiView> = {}): UiView {
  return {
    slug: 'user-profile',
    title: 'User Profile Screen',
    url: '/users/:id/:tab',
    description: 'Shows one user.',
    params: [
      { name: 'q', in: 'query', type: 'string' },
      { name: 'id', in: 'path', type: 'uuid', required: true },
    ],
    states: [],
    designSystemSlug: null,
    tags: [],
    createdAt: '2026-10-10 10:00:00',
    updatedAt: '2026-10-10 10:00:00',
    ...over,
  } as UiView;
}

function listItem(over: Record<string, unknown> = {}) {
  return {
    type: 'ui-view',
    slug: 'user-profile',
    title: 'User Profile Screen',
    url: '/users/:id',
    description: 'Shows one user.',
    tags: [],
    paramsCount: 2,
    hasMockupHtml: false,
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
  state.view = sampleView();
  state.views = [];
  state.viewsLoading = false;
  state.refs = [];
  state.params = { slug: 'user-profile' };
  state.search = {};
  state.navigate = [];
  state.updates = [];
  state.deleted = [];
  state.modules = [
    mod('ui-view', 'UI View', 'UI Views', '/ui-views'),
    mod('design-system', 'Design System', 'Design Systems', '/design-systems'),
  ];
  state.tagPickers = [];
  state.headers = [];
  state.emptyStates = [];
  state.loadingStates = 0;
  state.segmented = [];
  state.historyViews = [];
  state.badges = [];
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
  const routes = uiViewRoutes({ rootRoute: {} } as never) as unknown as Array<{
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

describe('[entity:ui-view-detail] /ui-views/:slug', () => {
  it('[entity:ui-view-detail] is registered under /ui-views/$slug (+ preview, history) and renders breadcrumb, three-tab SegmentedControlTabs, Delete — no Edit; fields edit in place', async () => {
    const routes = routeTable();
    // url `/ui-views/:slug` — TanStack spells the path param `$slug`.
    const detail = routes.get('/ui-views/$slug');
    expect(detail).toBeDefined();
    expect(routes.has('/ui-views/$slug/preview')).toBe(true);
    expect(routes.has('/ui-views/$slug/history')).toBe(true);

    await render(createElement(detail!.component));

    const text = container.textContent ?? '';
    // Breadcrumb: list label + the view.
    expect(buttonByText('UI Views', container)).toBeDefined();
    expect(text).toContain('User Profile Screen');
    // Three tabs through the catalog's SegmentedControlTabs, `details` active.
    const seg = state.segmented.at(-1)!;
    expect(seg.active).toBe('details');
    expect(seg.tabs.map((t) => t.label)).toEqual(['Details', 'Preview', 'History']);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
    // The wrapper holds no copy of the control's anatomy.
    expect(switcherSrc).toMatch(/<SegmentedControlTabs/);
    expect(switcherSrc).not.toMatch(/<button/);
    // Delete on the route's toolbar — exactly one; no Edit button anywhere.
    expect(
      Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Delete'),
    ).toHaveLength(1);
    expect(buttonByText('Edit', container)).toBeUndefined();
    // Fields edit in place: title, URL and each parameter are inputs on the page.
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.some((i) => i.value === 'User Profile Screen')).toBe(true);
    expect(inputs.some((i) => i.value === '/users/:id/:tab')).toBe(true);
    // Tags: `TagPicker` in the `collapsed` variant.
    expect(state.tagPickers.at(-1)?.variant).toBe('collapsed');
  });

  it('[entity:ui-view-detail] Parameters is a FieldRow grid (name | in | type | req | default | description | ⚠ | ×), sorted path → query → hash, flagging path params of the URL missing from params, with + Add parameter', async () => {
    await render(createElement(routeTable().get('/ui-views/$slug')!.component));

    const grid = container.querySelector('[data-testid="ui-view-params-grid"]');
    expect(grid).not.toBeNull();
    // Inside the FieldRow labelled "Parameters".
    expect(grid!.parentElement?.previousElementSibling?.textContent).toBe('Parameters');
    const headers = Array.from(grid!.querySelectorAll('[role="columnheader"]')).map((c) => c.textContent);
    expect(headers).toEqual(['name', 'in', 'type', 'req', 'default', 'description', '⚠', '×']);
    // Sorted by `in`: the path param `id` comes before the query param `q`.
    const names = (Array.from(grid!.querySelectorAll('input')) as HTMLInputElement[])
      .filter((i) => i.placeholder === 'param_name')
      .map((i) => i.value);
    expect(names).toEqual(['id', 'q']);
    // `:tab` is in the URL but not in params → flagged; `:id` is declared → not.
    const warning = grid!.querySelector('[data-testid="ui-view-missing-path-params"]');
    expect(warning?.textContent).toContain(':tab');
    expect(warning?.textContent).not.toContain(':id');
    // + Add parameter appends a row.
    const add = buttonByText('Add parameter', grid!);
    expect(add).toBeDefined();
    await act(async () => add!.click());
    const after = (Array.from(grid!.querySelectorAll('input')) as HTMLInputElement[]).filter(
      (i) => i.placeholder === 'param_name',
    );
    expect(after).toHaveLength(3);
  });

  it('[entity:ui-view-detail] with no parameters the grid says "No parameters defined yet." and no warning shows when the URL has no path params', async () => {
    state.view = sampleView({ url: '/settings', params: [] });
    await render(createElement(routeTable().get('/ui-views/$slug')!.component));
    const grid = container.querySelector('[data-testid="ui-view-params-grid"]');
    expect(grid?.textContent).toContain('No parameters defined yet.');
    expect(grid?.querySelector('[data-testid="ui-view-missing-path-params"]')).toBeNull();
  });

  it('[entity:ui-view-detail] Find references row: "Not referenced by any page." without citations, the citing pages otherwise', async () => {
    await render(createElement(routeTable().get('/ui-views/$slug')!.component));
    expect(container.textContent).toContain('Find references');
    expect(container.textContent).toContain('Not referenced by any page.');

    state.refs = [{ rootId: 'pages', pagePath: 'modules/m01-users.md', line: 12, tagType: 'inline_mention' }];
    await render(createElement(routeTable().get('/ui-views/$slug')!.component));
    expect(container.textContent).not.toContain('Not referenced by any page.');
    expect(buttonByText('modules/m01-users.md', container)).toBeDefined();
  });

  it('[entity:ui-view-detail] Delete asks through the host confirmation window (ui-view-delete), toasts "View deleted", then goes to the list', async () => {
    const toasts: string[] = [];
    const onConfirm = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; title: string; body: string; onConfirm: () => void };
      state.confirms.push(d);
      d.onConfirm();
    };
    const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message as string);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ references: [], total: 0 }), { status: 200 }));
    window.addEventListener('c4s:confirm-open', onConfirm);
    window.addEventListener('c4s:toast', onToast);
    try {
      await render(createElement(routeTable().get('/ui-views/$slug')!.component));
      await act(async () => {
        buttonByText('Delete', container)!.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(state.confirms).toHaveLength(1);
      expect(state.confirms[0]!.kind).toBe('ui-view-delete');
      expect(state.confirms[0]!.title).toBe('Delete UI view?');
      expect(state.confirms[0]!.body).toBe(deleteUiViewBody('User Profile Screen', 0));
      // Through the route's delete mutation.
      expect(state.deleted).toEqual(['user-profile']);
      expect(toasts).toContain('View deleted');
      expect(state.navigate.at(-1)).toMatchObject({ to: '/ui-views' });
    } finally {
      window.removeEventListener('c4s:confirm-open', onConfirm);
      window.removeEventListener('c4s:toast', onToast);
      fetchSpy.mockRestore();
    }
  });

  it('[entity:ui-view-detail] a new tag name goes to the entity draft and is sent with the entity save — no tag created up front, no TagCreatePopover', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await render(createElement(routeTable().get('/ui-views/$slug')!.component));
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
      expect(state.updates.at(-1)?.slug).toBe('user-profile');
      expect(state.updates.at(-1)?.input.tags).toEqual(['auth-layer']);
      // Nothing created the tag on its own (no POST to the tags API).
      const tagPosts = fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/tags') && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(tagPosts).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(detailSrc).not.toMatch(/TagCreatePopover/);
  });

  it('[entity:ui-view-detail] the sidebar tab carries no emptyState', () => {
    expect(uiViewFrontendModule.sidebarTab).toBeDefined();
    expect(uiViewFrontendModule.sidebarTab!.label).toBe('UI Views');
    expect('emptyState' in uiViewFrontendModule.sidebarTab!).toBe(false);
  });

  it('[entity:ui-view-detail] deleted entity: chip is the broken Badge with the slug, not clickable and with Alt gestures off (2.1.39, M13); card is a non-clickable broken frame', async () => {
    const Chip = uiViewFrontendModule.renderChip as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const Card = uiViewFrontendModule.renderCard as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const opened: string[] = [];
    const confirms: unknown[] = [];
    const onConfirm = (e: Event) => confirms.push((e as CustomEvent).detail);
    window.addEventListener('c4s:confirm-open', onConfirm);
    try {
      await render(
        createElement(
          'div',
          null,
          createElement(Chip, { slug: 'view-gone', entity: null, onOpen: () => opened.push('chip') }),
          createElement(Card, { slug: 'view-gone', entity: null, onOpen: () => opened.push('card') }),
        ),
      );
      // The chip is the catalog's broken Badge with the slug — no button, no onOpen.
      const chip = container.querySelector<HTMLElement>('span.value-badge')!;
      expect(chip.textContent).toBe('⚠view-gone');
      expect(chip.closest('button')).toBeNull();
      await act(async () => chip.click());
      // Alt+click and Shift+Alt+click: no edit popover, no delete confirmation, no open.
      await act(async () => {
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true, shiftKey: true }));
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(confirms).toHaveLength(0);
      expect(document.body.textContent).not.toContain('Edit UI view');
      expect(opened).toEqual([]);
      // Card: the broken frame, not a button.
      expect(container.textContent).toContain('⚠ broken: ui-view "view-gone"');
      const frames = Array.from(container.querySelectorAll('button')).filter((b) =>
        b.textContent?.includes('broken: ui-view'),
      );
      expect(frames).toHaveLength(0);
    } finally {
      window.removeEventListener('c4s:confirm-open', onConfirm);
    }
  });
});

describe('[entity:ui-view-history] /ui-views/:slug/history', () => {
  it('[entity:ui-view-history] is registered under /ui-views/$slug/history and renders the host EntityVersionHistoryView for type ui-view with only type and slug — no history UI of its own', async () => {
    const history = routeTable().get('/ui-views/$slug/history');
    expect(history).toBeDefined();
    await render(createElement(history!.component));

    expect(state.historyViews.length).toBeGreaterThan(0);
    expect(state.historyViews.at(-1)).toEqual({ type: 'ui-view', slug: 'user-profile' });
    expect(container.querySelectorAll('[data-testid="entity-version-history-view"]')).toHaveLength(1);
    // The three-tab switcher over SegmentedControlTabs, History active.
    const seg = state.segmented.at(-1)!;
    expect(seg.active).toBe('history');
    expect(seg.tabs.map((t) => t.label)).toEqual(['Details', 'Preview', 'History']);
    // The Details panel is not rendered on the history route.
    expect(buttonByText('Add parameter', container)).toBeUndefined();
  });
});

describe('[entity:ui-view-list] /ui-views', () => {
  it('[entity:ui-view-list] 2.1.28 composition — the URL badge and the presence-only mockup chip are kit Badges; no mockup renders no chip', async () => {
    state.views = [
      listItem({ hasMockupHtml: false }),
      listItem({ slug: 'settings', title: 'Settings', url: null, paramsCount: 0, hasMockupHtml: true }),
    ];
    await render(createElement(routeTable().get('/ui-views')!.component));
    const labels = state.badges.map((b) => String(b.label));
    expect(labels).toContain('/users/:id');
    expect(labels).toContain('Mockup');
    // presence-only: one mockup row → the chip text appears once in the markup
    expect((container.textContent ?? '').match(/Mockup/g)).toHaveLength(1);
  });

  it('[entity:ui-view-list] is registered under /ui-views and renders EntityListHeader (title, count, search, New View) with rows carrying the parameter count', async () => {
    const list = routeTable().get('/ui-views');
    expect(list).toBeDefined();
    state.views = [
      listItem(),
      listItem({
        slug: 'settings',
        title: 'Settings',
        url: null,
        description: 'App settings.',
        paramsCount: 0,
        hasMockupHtml: true,
      }),
    ];
    await render(createElement(list!.component));

    const header = state.headers.at(-1)!;
    expect(header.title).toBe('UI Views');
    // Count = length of the fetched list.
    expect(header.count).toBe(2);
    expect(container.textContent).toContain('2 results');
    // Search box present.
    expect(header.search).toBe('');
    expect(container.querySelector('input[placeholder^="Search"]')).not.toBeNull();
    // "New …" action.
    expect(buttonByText('New View', container)).toBeDefined();
    // Rows: title + URL badge + parameter count + mockup chip + description.
    const text = container.textContent ?? '';
    expect(text).toContain('User Profile Screen');
    expect(text).toContain('/users/:id');
    expect(text).toContain('2p');
    expect(text).toContain('Settings');
    expect(text).toContain('0p');
    expect(text).toContain('Mockup');
    expect(text).toContain('App settings.');
    // No pagination, no error state.
    expect(text).not.toMatch(/Page \d+ of/);
    expect(state.loadingStates).toBe(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:ui-view-list] state loading — a LoadingState stands in for the rows', async () => {
    state.viewsLoading = true;
    await render(createElement(routeTable().get('/ui-views')!.component));
    expect(state.loadingStates).toBeGreaterThan(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:ui-view-list] state empty — one EmptyState with the type text and no filter reset', async () => {
    state.views = [];
    await render(
      createElement(UiViewsList, {
        search: 'nothing-matches',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(state.emptyStates.length).toBeGreaterThan(0);
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe(UI_VIEW_LIST_EMPTY_TITLE);
    expect(empty.action).toBeUndefined();
    expect(container.textContent).toContain(UI_VIEW_LIST_EMPTY_TITLE);
    expect(container.textContent).not.toMatch(/clear filters|reset|Create your first view/i);
  });
});

describe('[section:uvrender] ui-view — runtime binding outside the envelope', () => {
  it('[section:uvrender] the type binds at runtime to the host frontend services useTags and useReferences from @c4s/plugin-runtime, not through its envelope contribution', () => {
    const SRC = join(import.meta.dirname, '../../src');
    const detail = readFileSync(join(SRC, 'entity/ui-view/frontend/detail-panel.tsx'), 'utf-8');
    // Imported from the L11 runtime surface (the root leg, not `/ui`)…
    expect(detail).toMatch(/import \{ useTags \} from '@c4s\/plugin-runtime';/);
    expect(detail).toMatch(/import \{ useReferences \} from '@c4s\/plugin-runtime';/);
    // …and called by the screen for this type.
    expect(detail).toMatch(/useTags\(\)/);
    expect(detail).toMatch(/useReferences\('ui-view', /);
    // The envelope's `ui-view` contribution declares neither: the binding is a runtime one.
    const contribution = readFileSync(join(SRC, 'entity/ui-view/index.ts'), 'utf-8');
    expect(contribution).not.toMatch(/useTags|useReferences/);
    expect(typeof uiViewFrontendModule).toBe('object');
  });
});
