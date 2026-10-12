// @vitest-environment happy-dom
/**
 * 2.1.19 — the `database-table` type's own list, detail and history screens
 * (page `c4s-plugin-database-tables`: L11 manifest, L5 UI, L12 Host UI Kit).
 *
 *  - `database-table-list` (`/database-tables`): states `loading` (six-line
 *    `LoadingState`), `empty` ("No database tables yet.") and `no-results`
 *    ("No matching database tables."); no error state.
 *  - `database-table-detail` (`/database-tables/:slug`): `DetailPanelShell`
 *    breadcrumb (list label, slug) + Details / History `SegmentedControlTabs`;
 *    text Delete in the meta strip confirmed by the kit `Dialog` drawn in the
 *    panel (recorded debt — not `confirmDestructive`); no Edit. States
 *    `loading` (six-line skeleton, also on a non-404 failure) and `not-found`
 *    (`EmptyState` "Not found" with the slug).
 *  - `database-table-history` (`/database-tables/:slug/history`): the kit's
 *    `EntityVersionHistoryView` with type + slug; a successful Restore goes back
 *    to Details.
 *  - manifest: `sidebarTab` carries no `emptyState`.
 *
 * The kit components are the host's real ones (`src/client/host-ui-kit/**`),
 * except the history block and the prose editor; only the data hooks, the
 * router and the live plugin host are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type FC, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseTable, DatabaseTableListItem } from '../../src/entity/database-table/types.js';

const state = vi.hoisted(() => ({
  table: undefined as unknown,
  tables: [] as unknown[],
  tablesLoading: false,
  params: { slug: 'orders' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  deleted: [] as string[],
  tags: [] as unknown[],
  emptyStates: [] as Array<{ title: string; hint?: unknown; action?: unknown }>,
  loadingStates: [] as Array<{ lines?: number }>,
  historyViews: [] as Array<Record<string, unknown>>,
  confirms: 0,
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

vi.mock('@c4s/plugin-runtime', () => ({
  editorBridge: { openEntity: () => undefined },
  useTags: () => ({ data: state.tags }),
  useEntityTags: () => ({ data: [] }),
  useAssignTags: () => ({ mutate: () => undefined, isPending: false, error: null }),
  useRemoveEntityTag: () => ({ mutate: () => undefined, isPending: false, error: null }),
  useReferences: () => ({ data: [], isLoading: false }),
  confirmDestructive: () => {
    state.confirms += 1;
  },
}));

vi.mock('@c4s/plugin-runtime/ui', async () => {
  const { createElement: h } = await import('react');
  const [
    btnMod,
    hdrMod,
    layoutMod,
    emptyMod,
    loadMod,
    listRowMod,
    tagBarMod,
    shellMod,
    segMod,
    tagMod,
    dialogMod,
    formShellMod,
    formFieldMod,
  ] = await Promise.all([
    import('../../../../src/client/host-ui-kit/actions/ActionButton.js'),
    import('../../../../src/client/host-ui-kit/core/EntityListHeader.js'),
    import('../../../../src/client/host-ui-kit/list/EntityListLayout.js'),
    import('../../../../src/client/host-ui-kit/list/EmptyState.js'),
    import('../../../../src/client/host-ui-kit/actions/LoadingState.js'),
    import('../../../../src/client/host-ui-kit/list/EntityListRow.js'),
    import('../../../../src/client/host-ui-kit/list/TagFilterBar.js'),
    import('../../../../src/client/host-ui-kit/core/DetailPanelShell.js'),
    import('../../../../src/client/host-ui-kit/detail/SegmentedControlTabs.js'),
    import('../../../../src/client/host-ui-kit/detail/TagPicker.js'),
    import('../../../../src/client/host-ui-kit/overlay/Dialog.js'),
    import('../../../../src/client/host-ui-kit/overlay/FormShell.js'),
    import('../../../../src/client/host-ui-kit/form/FormField.js'),
  ]);
  const spy =
    <P,>(Real: FC<P>, sink: (p: P) => void): FC<P> =>
    (p: P) => {
      sink(p);
      return h(Real as FC<P>, p as never);
    };
  return {
    ActionButton: btnMod.ActionButton,
    EntityListHeader: hdrMod.EntityListHeader,
    EntityListLayout: layoutMod.EntityListLayout,
    EmptyState: spy(emptyMod.EmptyState, (p) => state.emptyStates.push(p as never)),
    LoadingState: spy(loadMod.LoadingState, (p) => state.loadingStates.push(p as never)),
    EntityListRow: listRowMod.EntityListRow,
    TagFilterBar: tagBarMod.TagFilterBar,
    DetailPanelShell: shellMod.DetailPanelShell,
    SegmentedControlTabs: segMod.SegmentedControlTabs,
    TagPicker: tagMod.TagPicker,
    Dialog: dialogMod.Dialog,
    FormShell: formShellMod.FormShell,
    FormField: formFieldMod.FormField,
    // The history block is the host's (connected to its own version hooks);
    // here it records what the plugin hands it and exposes its restore callback.
    EntityVersionHistoryView: (p: Record<string, unknown>) => {
      state.historyViews.push(p);
      return h(
        'button',
        { type: 'button', onClick: () => (p.onRestored as (id: string) => void)?.('3') },
        'Restore',
      );
    },
    // The prose editor: a plain textarea stands in for the ProseMirror one.
    DocEditor: ({ value }: { value: string }) => h('textarea', { 'aria-label': 'Description', defaultValue: value }),
  };
});

vi.mock('../../src/entity/database-table/frontend/hooks.js', () => ({
  useDatabaseTableList: () => ({
    data: state.tablesLoading ? undefined : state.tables,
    isLoading: state.tablesLoading,
  }),
  useGetBySlug: () => ({ data: state.table }),
  useUpdateDatabaseTable: () => ({ isPending: false, error: null, mutate: () => undefined }),
  useDeleteDatabaseTable: () => ({
    isPending: false,
    error: null,
    mutate: ({ slug }: { slug: string }, opts?: { onSuccess?: () => void }) => {
      state.deleted.push(slug);
      opts?.onSuccess?.();
    },
  }),
  useCreateDatabaseTable: () => ({ isPending: false, mutateAsync: async () => state.table }),
}));

import { databaseTableRoutes } from '../../src/entity/database-table/frontend/routes.js';
import {
  DATABASE_TABLE_LIST_EMPTY_HINT,
  DATABASE_TABLE_LIST_EMPTY_TITLE,
  DATABASE_TABLE_LIST_NO_RESULTS_HINT,
  DATABASE_TABLE_LIST_NO_RESULTS_TITLE,
} from '../../src/entity/database-table/frontend/routes.js';
import { databaseTableFrontendModule } from '../../src/entity/database-table/frontend/module.js';

const FRONTEND_SRC = join(import.meta.dirname, '../../src/entity/database-table/frontend');
const FRONTEND_KIT_SRC = join(import.meta.dirname, '../../src/frontend-kit');
const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf-8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleTable(over: Partial<DatabaseTable> = {}): DatabaseTable {
  return {
    slug: 'orders',
    title: 'orders',
    description: 'All orders.',
    columns: [{ name: 'id', type: 'uuid', pk: true }],
    indexes: [],
    tags: [],
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T10:00:00Z',
    ...over,
  } as DatabaseTable;
}

function sampleItem(over: Partial<DatabaseTableListItem> = {}): DatabaseTableListItem {
  return { slug: 'orders', title: 'orders', columns: [], indexes: [], tags: [], ...over };
}

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  state.table = sampleTable();
  state.tables = [];
  state.tablesLoading = false;
  state.params = { slug: 'orders' };
  state.search = {};
  state.navigate = [];
  state.deleted = [];
  state.tags = [];
  state.emptyStates = [];
  state.loadingStates = [];
  state.historyViews = [];
  state.confirms = 0;
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
  const routes = databaseTableRoutes({ rootRoute: {} } as never) as unknown as Array<{
    path: string;
    component: FC;
  }>;
  return new Map(routes.map((r) => [r.path, r]));
}

function buttonByText(text: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
}

describe('[entity:database-table-list] /database-tables', () => {
  it('[entity:database-table-list] is registered under /database-tables and renders the kit list with one row per table', async () => {
    const list = routeTable().get('/database-tables');
    expect(list).toBeDefined();
    state.tables = [sampleItem(), sampleItem({ slug: 'order-items', title: 'order_items' })];
    await render(createElement(list!.component));

    const text = container.textContent ?? '';
    expect(text).toContain('Database Tables');
    expect(text).toContain('orders');
    expect(text).toContain('order_items');
    expect(buttonByText('Create')).toBeDefined();
    expect(state.loadingStates).toHaveLength(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:database-table-list] state loading — a six-line LoadingState stands where the rows would', async () => {
    state.tablesLoading = true;
    await render(createElement(routeTable().get('/database-tables')!.component));
    expect(state.loadingStates.at(-1)?.lines).toBe(6);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:database-table-list] state empty — "No database tables yet." with the create hint', async () => {
    state.tables = [];
    await render(createElement(routeTable().get('/database-tables')!.component));
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe('No database tables yet.');
    expect(empty.hint).toBe('Create your first one to get started.');
    expect(DATABASE_TABLE_LIST_EMPTY_TITLE).toBe(empty.title);
    expect(DATABASE_TABLE_LIST_EMPTY_HINT).toBe(empty.hint);
    expect(container.textContent).toContain('No database tables yet.');
    expect(container.textContent).toContain('Create your first one to get started.');
  });

  it('[entity:database-table-list] state no-results — tables exist but none matches the search: "No matching database tables."', async () => {
    state.tables = [sampleItem()];
    state.search = { q: 'no-such-table' };
    await render(createElement(routeTable().get('/database-tables')!.component));
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe('No matching database tables.');
    expect(empty.hint).toBe('Try clearing the search or tag filter.');
    expect(DATABASE_TABLE_LIST_NO_RESULTS_TITLE).toBe(empty.title);
    expect(DATABASE_TABLE_LIST_NO_RESULTS_HINT).toBe(empty.hint);
    expect(container.textContent).not.toContain('No database tables yet.');
  });

  it('[entity:database-table-list] state no-results — the tag filter matching nothing shows the same no-results state', async () => {
    state.tables = [sampleItem({ tags: ['billing'] })];
    state.search = { tag: 'auth' };
    await render(createElement(routeTable().get('/database-tables')!.component));
    expect(state.emptyStates.at(-1)?.title).toBe('No matching database tables.');
  });

  it('[entity:database-table-list] has no error state and keeps the recorded query-key debt (outside the host prefixes)', () => {
    const routesSrc = read(FRONTEND_SRC, 'routes.tsx');
    expect(routesSrc).not.toMatch(/isError|Failed to load|Something went wrong/i);
    const hooksSrc = read(FRONTEND_SRC, 'hooks.ts');
    // `['database-table', 'list', q]` / `['database-table', 'detail', slug]` —
    // not under `['database-tables']`, `['database-table', slug]` or `['entities']`.
    expect(hooksSrc).toMatch(/list: \(q: DatabaseTableListQuery\) => \[DATABASE_TABLE_TYPE, 'list', q\]/);
    expect(hooksSrc).toMatch(/detail: \(slug: string\) => \[DATABASE_TABLE_TYPE, 'detail', slug\]/);
    // …and the package does not subscribe to the WS itself.
    const all = readdirSync(FRONTEND_SRC).map((f) => read(FRONTEND_SRC, f)).join('\n');
    expect(all).not.toMatch(/entity:changed|entity:indexed|useEntityChanged/);
  });
});

describe('[entity:database-table-detail] /database-tables/:slug', () => {
  it('[entity:database-table-detail] is registered under /database-tables/$slug and renders DetailPanelShell (list label, slug), Details / History tabs, a text Delete — no Edit', async () => {
    const detail = routeTable().get('/database-tables/$slug');
    expect(detail).toBeDefined();
    await render(createElement(detail!.component));

    const crumb = buttonByText('Database Tables');
    expect(crumb).toBeDefined();
    expect(crumb!.parentElement!.parentElement!.textContent).toMatch(/Database Tables.*orders$/);
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(['Details', 'History']);
    expect(Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Delete')).toHaveLength(1);
    expect(buttonByText('Edit')).toBeUndefined();
    expect((container.querySelector('textarea[aria-label="Table name"]') as HTMLTextAreaElement).value).toBe('orders');
  });

  it('[entity:database-table-detail] Delete is confirmed by the kit Dialog drawn in the panel, not confirmDestructive (recorded debt)', async () => {
    await render(createElement(routeTable().get('/database-tables/$slug')!.component));
    await act(async () => {
      buttonByText('Delete')!.click();
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Delete entity?');
    await act(async () => {
      buttonByText('Delete', dialog)!.click();
    });
    expect(state.deleted).toEqual(['orders']);
    expect(state.confirms).toBe(0);
    expect(state.navigate.at(-1)).toMatchObject({ to: '/database-tables' });
    expect(read(FRONTEND_SRC, 'detail-panel.tsx')).not.toMatch(/confirmDestructive\(/);
  });

  it('[entity:database-table-detail] state loading — an unresolved entity shows the six-line LoadingState skeleton', async () => {
    state.table = undefined;
    await render(createElement(routeTable().get('/database-tables/$slug')!.component));
    expect(state.loadingStates.at(-1)?.lines).toBe(6);
    expect(state.emptyStates).toHaveLength(0);
    expect(container.querySelector('textarea[aria-label="Table name"]')).toBeNull();
  });

  it('[entity:database-table-detail] state loading — a non-404 failure keeps the skeleton after three retries, with no message', () => {
    const hooksSrc = read(FRONTEND_SRC, 'hooks.ts');
    // Only a 404 becomes `null` (not-found); anything else rethrows, so `data`
    // stays `undefined` and the panel keeps drawing the skeleton.
    expect(hooksSrc).toMatch(/status === 404\) return null;\s*throw err;/);
    expect(hooksSrc).toMatch(/retry: \(count, err\) => \(err as \{ status\?: number \}\)\.status !== 404 && count < 3/);
    const detailSrc = read(FRONTEND_SRC, 'detail-panel.tsx');
    expect(detailSrc).toMatch(/if \(entity === undefined\) return <LoadingState lines=\{6\} \/>;/);
  });

  it('[entity:database-table-detail] state not-found — a 404 shows EmptyState "Not found" with the slug', async () => {
    state.table = null;
    state.params = { slug: 'ghost' };
    await render(createElement(routeTable().get('/database-tables/$slug')!.component));
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe('Not found');
    expect(container.textContent).toContain('Not found');
    expect(container.querySelector('code')?.textContent).toBe('ghost');
  });
});

describe('[entity:database-table-history] /database-tables/:slug/history', () => {
  it('[entity:database-table-history] is registered under /database-tables/$slug/history and renders EntityVersionHistoryView for the type and slug', async () => {
    const history = routeTable().get('/database-tables/$slug/history');
    expect(history).toBeDefined();
    await render(createElement(history!.component));

    const view = state.historyViews.at(-1)!;
    expect(view.type).toBe('database-table');
    expect(view.slug).toBe('orders');
    expect(buttonByText('Database Tables')).toBeDefined();
    const active = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(active?.textContent).toBe('History');
  });

  it('[entity:database-table-history] a successful Restore goes back to the Details view of the table', async () => {
    await render(createElement(routeTable().get('/database-tables/$slug/history')!.component));
    await act(async () => {
      buttonByText('Restore')!.click();
    });
    expect(state.navigate.at(-1)).toMatchObject({
      to: '/database-tables/$slug',
      params: { slug: 'orders' },
      replace: true,
    });
  });
});

describe('[section:ityp8g1r] manifest sidebarTab', () => {
  it('[section:ityp8g1r] the ELEMENTS tab declares icon, label and order — emptyState is unset', () => {
    const tab = databaseTableFrontendModule.sidebarTab!;
    expect(tab).toBeDefined();
    expect(tab.icon).toBeDefined();
    expect(tab.label).toBe('Database Tables');
    expect(typeof tab.order).toBe('number');
    expect('emptyState' in tab).toBe(false);
  });
});

describe('[section:uyu88bdw] Host UI Kit slice', () => {
  it('[section:uyu88bdw] the package consumes exactly the catalog components the slice lists, and keeps the popover form as local debt', () => {
    const consumed = new Set<string>();
    const sources = [
      ...readdirSync(FRONTEND_SRC).map((f) => read(FRONTEND_SRC, f)),
      ...readdirSync(FRONTEND_KIT_SRC).map((f) => read(FRONTEND_KIT_SRC, f)),
    ];
    for (const src of sources) {
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@c4s\/plugin-runtime\/ui'/g)) {
        for (const name of m[1]!.split(',')) {
          const n = name.trim();
          if (!n || n.startsWith('type ')) continue;
          consumed.add(n);
        }
      }
    }
    expect([...consumed].sort()).toEqual(
      [
        'EntityListLayout',
        'EntityListHeader',
        'EntityListRow',
        'TagFilterBar',
        'LoadingState',
        'EmptyState',
        'DetailPanelShell',
        'SegmentedControlTabs',
        'TagPicker',
        'DocEditor',
        'EntityVersionHistoryView',
        'Dialog',
        'FormShell',
        'FormField',
        'ActionButton',
      ].sort(),
    );
    // DEBT: the popover form stays a package-local copy in `frontend-kit/`.
    const popoverForm = read(FRONTEND_KIT_SRC, 'popover-form.tsx');
    for (const local of ['FieldLabel', 'TextInput', 'SelectInput', 'InlineError', 'PopoverFooter']) {
      expect(popoverForm).toMatch(new RegExp(`export (const|function) ${local}\\b`));
    }
  });
});
