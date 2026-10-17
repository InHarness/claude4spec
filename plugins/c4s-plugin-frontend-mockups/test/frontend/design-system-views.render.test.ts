// @vitest-environment happy-dom
/**
 * 2.1.19 — the `design-system` type's detail and list screens.
 *
 *  - `design-system-detail` (`/design-systems/:slug`): the route renders the
 *    breadcrumb (type icon + title, slug without a title) and the Details /
 *    History switcher over the catalog's `SegmentedControlTabs`; no Edit button;
 *    Delete sits in the panel's meta strip and confirms through the host window
 *    `design-system-delete`, whose body gives the number of referencing pages.
 *    Alternative state `load-failed` — "Failed to load: …", also for a 404.
 *  - `design-system-list` (`/design-systems`): header, rows with the
 *    groups/tokens count; states `loading` (five-line `LoadingState`) and
 *    `empty` (one `EmptyState` for "none" and "none matching" alike, with
 *    "Create your first design system").
 *  - the sidebar tab declares no `emptyState`.
 *
 * The kit components are the host's real ones (`src/client/host-ui-kit/**`);
 * only the data hooks, the router and the live plugin host are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type FC, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignSystem } from '../../src/types.js';

const state = vi.hoisted(() => ({
  ds: null as unknown,
  dsError: null as Error | null,
  list: [] as unknown[],
  listLoading: false,
  refs: [] as unknown[],
  params: { slug: 'acme-tokens' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  deleted: [] as string[],
  modules: [] as Array<Record<string, unknown>>,
  headers: [] as Array<{ count?: number; title: string; search?: string }>,
  emptyStates: [] as Array<{ title: string; hint?: unknown; action?: unknown }>,
  loadingStates: [] as Array<{ lines?: number }>,
  segmented: [] as Array<{ active: string; tabs: Array<{ id: string; label: string }> }>,
  historyViews: [] as Array<Record<string, unknown>>,
  allTags: [] as Array<{ slug: string; name: string; color: string | null }>,
  tagPickers: [] as Array<{ variant?: string }>,
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
    useTags: () => ({ data: state.allTags }),
    useReferences: () => ({ data: state.refs }),
    EditorBridgeProvider: ({ children }: { children: ReactNode }) => children,
    queryClient: null,
  };
});

// The kit's own `Badge` module is recorded, not only the `/ui` export: the kit
// components that draw chips (`EntityListRow`, `TagPicker`, `TagFilterBar`)
// import it from `../actions/Badge.js`, so a spy on the `/ui` re-export alone
// would never see the tag chips they render through Badge.
vi.mock('../../../../src/client/host-ui-kit/actions/Badge.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../src/client/host-ui-kit/actions/Badge.js')>();
  const { createElement: h } = await import('react');
  const Real = real.Badge as unknown as FC<Record<string, unknown>>;
  // React's development build may call a function component with no props to
  // build a component stack; only calls with props are recorded.
  const Badge = (p?: Record<string, unknown>) => {
    if (!p) return null;
    state.badges.push(p as never);
    return h(Real, p as never);
  };
  // Keep the catalog statics (`stability`, `binding`) of the real entry.
  return { ...real, Badge: Object.assign(Badge, real.Badge) };
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
  ]);
  const spy =
    <P,>(Real: FC<P>, sink: (p: P) => void): FC<P> =>
    (p: P) => {
      sink(p);
      return h(Real as FC<P>, p as never);
    };
  const Passthrough = ({ children }: { children?: ReactNode }) => h('div', null, children);
  return {
    TagPicker: spy(tagMod.TagPicker, (p) => { if (p) state.tagPickers.push(p as never); }),
    // Already recorded by the mock of the kit's Badge module above.
    Badge: badgeMod.Badge,
    FieldRow: rowMod.FieldRow,
    FieldGrid: gridMod.FieldGrid,
    ActionButton: btnMod.ActionButton,
    EntityListHeader: spy(hdrMod.EntityListHeader, (p) => state.headers.push(p as never)),
    EntityListLayout: layoutMod.EntityListLayout,
    EmptyState: spy(emptyMod.EmptyState, (p) => state.emptyStates.push(p as never)),
    LoadingState: spy(loadMod.LoadingState, (p) => state.loadingStates.push(p as never)),
    EntityListRow: listRowMod.EntityListRow,
    TagFilterBar: tagBarMod.TagFilterBar,
    Popover: popMod.Popover,
    SegmentedControlTabs: spy(segMod.SegmentedControlTabs, (p) => state.segmented.push(p as never)),
    // The description editor: a plain textarea stands in for the ProseMirror one.
    DocEditor: ({ value }: { value: string }) => h('textarea', { 'aria-label': 'Description', defaultValue: value }),
    // The host history block: records exactly the props the route hands it.
    // React's dev build may also call a component with no props (component
    // stack); only calls with props are recorded.
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

vi.mock('../../src/entity/design-system/frontend/hooks.js', () => ({
  useDesignSystem: () => ({
    data: state.ds ?? undefined,
    isLoading: false,
    error: state.dsError,
  }),
  useDesignSystems: () => ({
    data: state.listLoading ? undefined : state.list,
    isLoading: state.listLoading,
  }),
  useUpdateDesignSystem: () => ({
    isPending: false,
    mutateAsync: async ({ input }: { slug: string; input: Record<string, unknown> }) => ({
      ...(state.ds as object),
      ...input,
    }),
  }),
  useDeleteDesignSystem: () => ({
    isPending: false,
    mutateAsync: async (slug: string) => {
      state.deleted.push(slug);
      return { deleted: true };
    },
  }),
  useCreateDesignSystem: () => ({ isPending: false, mutateAsync: async () => state.ds }),
}));

import { designSystemRoutes } from '../../src/entity/design-system/frontend/routes.js';
import {
  DesignSystemsList,
  DESIGN_SYSTEM_LIST_CREATE_LABEL,
  DESIGN_SYSTEM_LIST_EMPTY_TITLE,
} from '../../src/entity/design-system/frontend/list-page.js';
import { designSystemFrontendModule } from '../../src/entity/design-system/frontend/module.js';
import {
  DESIGN_SYSTEM_DELETE_TITLE,
  deleteDesignSystemBody,
} from '../../src/entity/design-system/frontend/detail-panel.js';
import { ApiError } from '../../src/frontend-kit/api-core.js';
import { DESIGN_SYSTEM_SIDEBAR_ORDER, UI_VIEW_SIDEBAR_ORDER } from '../../src/identity.js';
import { Palette } from 'lucide-react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleDs(over: Partial<DesignSystem> = {}): DesignSystem {
  return {
    slug: 'acme-tokens',
    title: 'Acme Tokens',
    description: 'Brand tokens.',
    groups: [
      {
        name: 'colors',
        tier: 'primitive',
        tokens: [
          { name: 'blue-500', type: 'color', value: '#2563eb' },
          { name: 'red-500', type: 'color', value: '#dc2626' },
        ],
      },
    ],
    modes: [],
    tags: [],
    createdAt: '2026-10-10 10:00:00',
    updatedAt: '2026-10-10 10:00:00',
    ...over,
  } as DesignSystem;
}

function listItem(over: Record<string, unknown> = {}) {
  return {
    type: 'design-system',
    slug: 'acme-tokens',
    title: 'Acme Tokens',
    description: 'Brand tokens.',
    tags: [],
    groupsCount: 3,
    createdAt: '2026-10-10 10:00:00',
    updatedAt: '2026-10-10 10:00:00',
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  state.ds = sampleDs();
  state.dsError = null;
  state.list = [];
  state.listLoading = false;
  state.refs = [];
  state.params = { slug: 'acme-tokens' };
  state.search = {};
  state.navigate = [];
  state.deleted = [];
  state.modules = [
    { type: 'ui-view', label: 'UI View', labelPlural: 'UI Views', pathPrefix: '/ui-views' },
    {
      type: 'design-system',
      label: 'Design System',
      labelPlural: 'Design Systems',
      pathPrefix: '/design-systems',
    },
  ];
  state.headers = [];
  state.emptyStates = [];
  state.loadingStates = [];
  state.segmented = [];
  state.historyViews = [];
  state.allTags = [];
  state.tagPickers = [];
  state.badges = [];
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
  const routes = designSystemRoutes({ rootRoute: {} } as never) as unknown as Array<{
    path: string;
    component: FC;
  }>;
  return new Map(routes.map((r) => [r.path, r]));
}

function buttons(text: string, scope: ParentNode = document): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll('button')).filter(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement[];
}

describe('[entity:design-system-detail] /design-systems/:slug', () => {
  it('[entity:design-system-detail] is registered under /design-systems/$slug (+ history) and renders breadcrumb (title), Details/History SegmentedControlTabs, the panel — no Edit button', async () => {
    const routes = routeTable();
    // url `/design-systems/:slug` — TanStack spells the path param `$slug`.
    const detail = routes.get('/design-systems/$slug');
    expect(detail).toBeDefined();
    expect(routes.has('/design-systems/$slug/history')).toBe(true);
    // No preview tab for this type.
    expect(routes.has('/design-systems/$slug/preview')).toBe(false);

    await render(createElement(detail!.component));

    // Breadcrumb: list label, then the type icon and the design system's title.
    expect(buttons('Design Systems', container)).toHaveLength(1);
    const crumbs = buttons('Design Systems', container)[0]!.parentElement!;
    expect(crumbs.textContent).toContain('Acme Tokens');
    expect(crumbs.querySelector('svg')).not.toBeNull();
    // Switcher: the catalog's SegmentedControlTabs, Details active, two tabs.
    const seg = state.segmented.at(-1)!;
    expect(seg.active).toBe('details');
    expect(seg.tabs.map((t) => t.label)).toEqual(['Details', 'History']);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    // No Edit button — fields edit in place (title is an input on the page).
    expect(buttons('Edit', container)).toHaveLength(0);
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.some((i) => i.value === 'Acme Tokens')).toBe(true);
    // Header badge with the group / token count.
    expect(container.textContent).toContain('1 groups / 2 tokens');
    // Exactly one Delete, in the meta strip.
    expect(buttons('Delete', container)).toHaveLength(1);
  });

  it('[entity:design-system-detail] breadcrumb falls back to the slug when the design system has no title', async () => {
    state.ds = sampleDs({ title: undefined as unknown as string });
    await render(createElement(routeTable().get('/design-systems/$slug')!.component));
    const crumbs = buttons('Design Systems', container)[0]!.parentElement!;
    expect(crumbs.textContent).toBe('Design Systemsacme-tokens');
  });

  it('[entity:design-system-detail] Delete in the meta strip confirms through the host window design-system-delete, giving the number of referencing pages, then goes to the list', async () => {
    // Three hits on two pages → two pages.
    state.refs = [
      { rootId: 'pages', pagePath: 'modules/m01.md', line: 3, tagType: 'inline_mention', raw: '' },
      { rootId: 'pages', pagePath: 'modules/m01.md', line: 9, tagType: 'inline_mention', raw: '' },
      { rootId: 'pages', pagePath: 'modules/m02.md', line: 4, tagType: 'single_element', raw: '' },
    ];
    const confirms: Array<{ kind: string; title: string; body: string }> = [];
    const toasts: string[] = [];
    const onConfirm = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; title: string; body: string; onConfirm: () => void };
      confirms.push(d);
      d.onConfirm();
    };
    const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message as string);
    window.addEventListener('c4s:confirm-open', onConfirm);
    window.addEventListener('c4s:toast', onToast);
    try {
      await render(createElement(routeTable().get('/design-systems/$slug')!.component));
      await act(async () => {
        buttons('Delete', container)[0]!.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(confirms).toHaveLength(1);
      expect(confirms[0]!.kind).toBe('design-system-delete');
      expect(confirms[0]!.title).toBe(DESIGN_SYSTEM_DELETE_TITLE);
      expect(confirms[0]!.body).toBe(deleteDesignSystemBody('Acme Tokens', 2));
      expect(confirms[0]!.body).toContain('2 pages reference it');
      expect(state.deleted).toEqual(['acme-tokens']);
      expect(toasts).toContain('Design system Acme Tokens deleted');
      expect(state.navigate.at(-1)).toMatchObject({ to: '/design-systems' });
    } finally {
      window.removeEventListener('c4s:confirm-open', onConfirm);
      window.removeEventListener('c4s:toast', onToast);
    }
    // Wording of the count sentence.
    expect(deleteDesignSystemBody('X', 1)).toContain('1 page references it');
    expect(deleteDesignSystemBody('X', 0)).not.toMatch(/page/);
  });

  it('[entity:design-system-detail] state load-failed — "Failed to load: …" with the error message, also when the slug is missing (404); no separate not-found screen', async () => {
    state.ds = null;
    state.dsError = new ApiError('NOT_FOUND', "design-system 'ghost' not found", 404);
    state.params = { slug: 'ghost' };
    await render(createElement(routeTable().get('/design-systems/$slug')!.component));
    expect(container.textContent).toContain("Failed to load: design-system 'ghost' not found");
    expect(container.textContent).not.toContain('Design System not found');
    expect(buttons('Delete', container)).toHaveLength(0);

    state.dsError = new Error('Internal error');
    await render(createElement(routeTable().get('/design-systems/$slug')!.component));
    expect(container.textContent).toContain('Failed to load: Internal error');
  });

  it('[entity:design-system-detail] the sidebar tab is Palette / "Design Systems" at its sidebar order and carries no emptyState', () => {
    const tab = designSystemFrontendModule.sidebarTab!;
    expect(tab).toBeDefined();
    expect(tab.icon).toBe(Palette);
    expect(tab.label).toBe('Design Systems');
    // The spec's manifest sketch writes `order: 6`; the code keeps the host-scale
    // position it inherited (60, after ui-view at 40 and ac at 50) — unchanged by
    // 2.1.19, which only drops `emptyState`. See ASSUMPTION:dev-1911.
    expect(tab.order).toBe(DESIGN_SYSTEM_SIDEBAR_ORDER);
    // 2.1.26 — `sidebarTab.order` is the ONLY ordering: the identity has no `displayOrder`.
    expect('displayOrder' in designSystemFrontendModule).toBe(false);
    expect(tab.order).toBeGreaterThan(UI_VIEW_SIDEBAR_ORDER);
    expect('emptyState' in tab).toBe(false);
  });
});

describe('[entity:design-system-history] /design-systems/:slug/history', () => {
  it('[entity:design-system-history] is registered under /design-systems/$slug/history and renders the host EntityVersionHistoryView for type design-system with only type and slug — no history UI of its own', async () => {
    const history = routeTable().get('/design-systems/$slug/history');
    expect(history).toBeDefined();
    await render(createElement(history!.component));

    expect(state.historyViews.length).toBeGreaterThan(0);
    // The same generic block as endpoint-history: type + slug, nothing type-specific.
    expect(state.historyViews.at(-1)).toEqual({ type: 'design-system', slug: 'acme-tokens' });
    expect(container.querySelectorAll('[data-testid="entity-version-history-view"]')).toHaveLength(1);
    // The Details / History switcher over SegmentedControlTabs, History active.
    const seg = state.segmented.at(-1)!;
    expect(seg.active).toBe('history');
    expect(seg.tabs.map((t) => t.label)).toEqual(['Details', 'History']);
    // The detail panel is not rendered on the history route.
    expect(buttons('Delete', container)).toHaveLength(0);
  });
});

describe('[entity:design-system-detail] 2.1.28 composition', () => {
  it('[entity:design-system-detail] tags are a collapsed kit TagPicker whose chips render through Badge', async () => {
    state.allTags = [{ slug: 'brand', name: 'Brand', color: null }];
    state.ds = sampleDs({ tags: ['brand'] } as Partial<DesignSystem>);
    await render(createElement(routeTable().get('/design-systems/$slug')!.component));
    expect(state.tagPickers.length).toBeGreaterThan(0);
    expect(state.tagPickers.at(-1)!.variant).toBe('collapsed');
    expect(state.badges.map((b) => String(b.label))).toContain('Brand');
  });
});

describe('[entity:design-system-list] /design-systems', () => {
  it('[entity:design-system-list] 2.1.28 composition — rows and the tag bar are the kit EntityListRow and TagFilterBar (the package files are bare re-exports of /ui); the groups/tokens counter stays the recorded CountBadge debt', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const kitDir = join(import.meta.dirname, '../../src/frontend-kit');
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // TagFilterBar shim: nothing but the /ui re-export.
    expect(strip(readFileSync(join(kitDir, 'TagFilterBar.tsx'), 'utf-8')).trim()).toBe(
      "export * from '@c4s/plugin-runtime/ui';",
    );
    // EntityListRow shim: the /ui re-export, plus the recorded CountBadge debt only.
    const rowShim = readFileSync(join(kitDir, 'EntityListRow.tsx'), 'utf-8');
    expect(rowShim).toMatch(/export \* from '@c4s\/plugin-runtime\/ui';/);
    expect(rowShim).toMatch(/DEBT \([^)]*Host UI Kit[^)]*\): `CountBadge`/);
    expect(strip(rowShim)).not.toMatch(/export function EntityListRow\b/);

    state.list = [listItem({ tags: ['brand'] })];
    await render(
      createElement(DesignSystemsList, {
        search: '',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    // The row's tag chip comes from the kit row, through Badge.
    expect(state.badges.map((b) => String(b.label))).toContain('brand');
    expect(container.textContent).toContain('3 groups');
  });

  it('[entity:design-system-list] is registered under /design-systems and renders the header (title, count, search, New Design System) and rows with the groups count, sorted by title', async () => {
    const list = routeTable().get('/design-systems');
    expect(list).toBeDefined();
    state.list = [
      listItem({ slug: 'zeta', title: 'Zeta', description: 'Last.', groupsCount: 1 }),
      listItem(),
    ];
    await render(createElement(list!.component));

    const header = state.headers.at(-1)!;
    expect(header.title).toBe('Design Systems');
    expect(header.count).toBe(2);
    expect(header.search).toBe('');
    expect(container.querySelector('input[placeholder^="Search"]')).not.toBeNull();
    expect(container.textContent).toContain('New Design System');
    const text = container.textContent ?? '';
    expect(text).toContain('3 groups');
    expect(text).toContain('1 groups');
    expect(text).toContain('Brand tokens.');
    expect(text.indexOf('Acme Tokens')).toBeLessThan(text.indexOf('Zeta'));
    // Neither alternative state.
    expect(state.loadingStates).toHaveLength(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:design-system-list] state loading — a five-line LoadingState skeleton stands in for the rows', async () => {
    state.listLoading = true;
    await render(createElement(routeTable().get('/design-systems')!.component));
    expect(state.loadingStates.length).toBeGreaterThan(0);
    expect(state.loadingStates.at(-1)!.lines).toBe(5);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:design-system-list] state empty — one EmptyState with the type text and "Create your first design system", for no design systems and for no match alike', async () => {
    const props = {
      tagFilter: [],
      onSearchChange: () => undefined,
      onTagToggle: () => undefined,
      onSelect: () => undefined,
    };
    for (const search of ['', 'nothing-matches']) {
      state.emptyStates = [];
      state.list = [];
      await render(createElement(DesignSystemsList, { ...props, search }));
      expect(state.emptyStates.length).toBeGreaterThan(0);
      expect(state.emptyStates.at(-1)!.title).toBe(DESIGN_SYSTEM_LIST_EMPTY_TITLE);
      expect(container.textContent).toContain(
        'No design systems yet. Create one with /design-system in the editor.',
      );
      expect(buttons(DESIGN_SYSTEM_LIST_CREATE_LABEL, container)).toHaveLength(1);
      expect(DESIGN_SYSTEM_LIST_CREATE_LABEL).toBe('Create your first design system');
    }
  });
});
