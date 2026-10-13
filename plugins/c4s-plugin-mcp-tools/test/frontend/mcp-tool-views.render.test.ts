// @vitest-environment happy-dom
/**
 * 2.1.19 — the `mcp-tool` type's own list, detail and history screens
 * (page `c4s-plugin-mcp-tools`: L11 manifest, L5 UI, L12 Host UI Kit).
 *
 *  - `mcp-tool-list` (`/mcp-tools`): grouped by server through the kit's
 *    `GroupedEntityList` by default, "Flat list" toggle; `TagFilterBar` only when
 *    tools of the type carry tags; states `loading` (six-line `LoadingState`),
 *    `empty` ("No MCP tools described yet.") and `no-results` ("No matching MCP
 *    tools."); no error state; query keys outside the host prefixes (debt).
 *  - `mcp-tool-detail` (`/mcp-tools/:slug`): the package breadcrumb with the
 *    Details / History switcher on `SegmentedControlTabs`; Delete in the meta
 *    strip asks "Delete this tool?" through `confirmDestructive`; no Edit.
 *    States `not-found` ("No MCP tool at `{slug}`.") and `load-failed` (red
 *    "Failed to load: {message}").
 *  - `mcp-tool-history` (`/mcp-tools/:slug/history`): the kit's
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
import type { McpTool } from '../../src/entity/mcp-tool/types.js';

const state = vi.hoisted(() => ({
  tool: undefined as unknown,
  toolLoading: false,
  toolError: null as unknown,
  tools: [] as unknown[],
  toolsLoading: false,
  params: { slug: 'docs-read-page' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  deleted: [] as string[],
  tags: [] as unknown[],
  emptyStates: [] as Array<{ title: string; hint?: unknown; action?: unknown }>,
  loadingStates: [] as Array<{ lines?: number }>,
  tagBars: [] as Array<Record<string, unknown>>,
  groupedLists: [] as Array<{ groups: Array<{ key: string; label: unknown; items: unknown[] }> }>,
  historyViews: [] as Array<Record<string, unknown>>,
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
  const { createElement: h, Fragment } = await import('react');
  // 2.1.20 (M50 `tbeatf5z`): the plugin opens windows and toasts through the
  // shell facades of `@c4s/plugin-runtime` — the host's own functions, so the
  // real ones stand in here and the confirm window they open is observed below.
  const host = await import('../../../../src/client/ui/events.js');
  return {
    openPopover: host.openPopover,
    openModal: host.openModal,
    confirmDestructive: host.confirmDestructive,
    toast: host.toast,
    clientPluginHost: { getEntity: () => undefined, getAvailable: () => undefined },
    editorBridge: { openEntity: () => undefined },
    EditorBridgeProvider: ({ children }: { children: ReactNode }) => h(Fragment, null, children),
    useTags: () => ({ data: state.tags }),
    useEntityTags: () => ({ data: [] }),
    useAssignTags: () => ({ mutate: () => undefined, isPending: false, error: null }),
    useRemoveEntityTag: () => ({ mutate: () => undefined, isPending: false, error: null }),
    useReferences: () => ({ data: [], isLoading: false }),
  };
});

vi.mock('@c4s/plugin-runtime/ui', async () => {
  const { createElement: h } = await import('react');
  const [
    btnMod,
    hdrMod,
    layoutMod,
    emptyMod,
    loadMod,
    listRowMod,
    groupedMod,
    tagBarMod,
    segMod,
    tagMod,
    gridMod,
    rowMod,
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
    import('../../../../src/client/host-ui-kit/list/GroupedEntityList.js'),
    import('../../../../src/client/host-ui-kit/list/TagFilterBar.js'),
    import('../../../../src/client/host-ui-kit/detail/SegmentedControlTabs.js'),
    import('../../../../src/client/host-ui-kit/detail/TagPicker.js'),
    import('../../../../src/client/host-ui-kit/core/FieldGrid.js'),
    import('../../../../src/client/host-ui-kit/core/FieldRow.js'),
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
    GroupedEntityList: spy(groupedMod.GroupedEntityList as FC<never>, (p) =>
      state.groupedLists.push(p as never),
    ),
    TagFilterBar: spy(tagBarMod.TagFilterBar, (p) => state.tagBars.push(p as never)),
    SegmentedControlTabs: segMod.SegmentedControlTabs,
    TagPicker: tagMod.TagPicker,
    FieldGrid: gridMod.FieldGrid,
    FieldRow: rowMod.FieldRow,
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
    DocEditor: ({ value }: { value: string }) =>
      h('textarea', { 'aria-label': 'Description', defaultValue: value }),
  };
});

vi.mock('../../src/entity/mcp-tool/frontend/hooks.js', () => ({
  useMcpToolList: () => ({
    data: state.toolsLoading ? undefined : state.tools,
    isLoading: state.toolsLoading,
  }),
  useGetBySlug: () => ({ data: state.tool, isLoading: state.toolLoading, error: state.toolError }),
  useUpdateMcpTool: () => ({ isPending: false, error: null, mutateAsync: async () => state.tool }),
  useDeleteMcpTool: () => ({
    isPending: false,
    error: null,
    mutateAsync: async ({ slug }: { slug: string }) => {
      state.deleted.push(slug);
    },
  }),
  useCreateMcpTool: () => ({ isPending: false, mutateAsync: async () => state.tool }),
  listByTags: async () => [],
}));

import {
  MCP_TOOL_LIST_EMPTY_HINT,
  MCP_TOOL_LIST_EMPTY_TITLE,
  MCP_TOOL_LIST_NO_RESULTS_HINT,
  MCP_TOOL_LIST_NO_RESULTS_TITLE,
  mcpToolRoutes,
} from '../../src/entity/mcp-tool/frontend/routes.js';
import { mcpToolFrontendModule } from '../../src/entity/mcp-tool/frontend/module.js';

const FRONTEND_SRC = join(import.meta.dirname, '../../src/entity/mcp-tool/frontend');
const FRONTEND_KIT_SRC = join(import.meta.dirname, '../../src/frontend-kit');
const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf-8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleTool(over: Partial<McpTool> = {}): McpTool {
  return {
    slug: 'docs-read-page',
    title: 'docs · read_page',
    name: 'read_page',
    server: 'docs',
    description: 'Read one page of the docs.',
    params: [{ name: 'path', type: 'string', required: true }],
    tags: [],
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T10:00:00Z',
    ...over,
  };
}

function sampleTag(slug: string, count: number) {
  return {
    slug,
    name: slug,
    color: null,
    description: null,
    counts: { 'mcp-tool': count },
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T10:00:00Z',
  };
}

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;
let confirmEvents: Array<Record<string, unknown>>;
const onConfirmOpen = (e: Event) => {
  const detail = (e as CustomEvent).detail as Record<string, unknown>;
  confirmEvents.push(detail);
  (detail.onConfirm as () => void)();
};

beforeEach(() => {
  state.tool = sampleTool();
  state.toolLoading = false;
  state.toolError = null;
  state.tools = [];
  state.toolsLoading = false;
  state.params = { slug: 'docs-read-page' };
  state.search = {};
  state.navigate = [];
  state.deleted = [];
  state.tags = [];
  state.emptyStates = [];
  state.loadingStates = [];
  state.tagBars = [];
  state.groupedLists = [];
  state.historyViews = [];
  confirmEvents = [];
  window.addEventListener('c4s:confirm-open', onConfirmOpen);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  window.removeEventListener('c4s:confirm-open', onConfirmOpen);
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
  const routes = mcpToolRoutes({ rootRoute: {} } as never) as unknown as Array<{
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

describe('[entity:mcp-tool-list] /mcp-tools', () => {
  it('[entity:mcp-tool-list] is registered under /mcp-tools and, by default, groups the tools by server through GroupedEntityList', async () => {
    const list = routeTable().get('/mcp-tools');
    expect(list).toBeDefined();
    state.tools = [
      sampleTool(),
      sampleTool({ slug: 'git-log', name: 'log', server: 'git' }),
      sampleTool({ slug: 'docs-search', name: 'search', server: 'docs' }),
    ];
    await render(createElement(list!.component));

    const grouped = state.groupedLists.at(-1)!;
    expect(grouped).toBeDefined();
    expect(grouped.groups.map((g) => g.label)).toEqual(['docs', 'git']);
    expect(grouped.groups[0]!.items).toHaveLength(2);
    const headings = Array.from(container.querySelectorAll('section > h2')).map((h) => h.textContent);
    expect(headings).toEqual(['docs', 'git']);
    const text = container.textContent ?? '';
    expect(text).toContain('MCP Tools');
    expect(text).toContain('read_page');
    expect(text).toContain('log');
    expect(buttonByText('Flat list')).toBeDefined();
    expect(buttonByText('Create')).toBeDefined();
    expect(state.loadingStates).toHaveLength(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:mcp-tool-list] the "Flat list" switch lays the tools out ungrouped (?group=flat)', async () => {
    state.tools = [sampleTool(), sampleTool({ slug: 'git-log', name: 'log', server: 'git' })];
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    await act(async () => {
      buttonByText('Flat list')!.click();
    });
    const nav = state.navigate.at(-1) as { search: (p: object) => object };
    expect(nav.search({})).toMatchObject({ group: 'flat' });

    state.groupedLists = [];
    state.search = { group: 'flat' };
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    expect(state.groupedLists).toHaveLength(0);
    expect(container.querySelectorAll('section > h2')).toHaveLength(0);
    expect(buttonByText('Group by server')).toBeDefined();
    expect(container.textContent).toContain('read_page');
  });

  it('[entity:mcp-tool-list] TagFilterBar appears only when tools of the type carry tags', async () => {
    state.tools = [sampleTool({ tags: ['srv-docs'] })];
    // A tag used only by other types does not count.
    state.tags = [sampleTag('billing', 0)];
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    expect(state.tagBars).toHaveLength(0);

    state.tags = [sampleTag('billing', 0), sampleTag('srv-docs', 1)];
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    const bar = state.tagBars.at(-1)!;
    expect(bar).toBeDefined();
    expect((bar.tags as Array<{ slug: string }>).map((t) => t.slug)).toEqual(['srv-docs']);
  });

  it('[entity:mcp-tool-list] state loading — a six-line LoadingState stands where the rows would', async () => {
    state.toolsLoading = true;
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    expect(state.loadingStates.at(-1)?.lines).toBe(6);
    expect(state.emptyStates).toHaveLength(0);
    expect(state.groupedLists).toHaveLength(0);
  });

  it('[entity:mcp-tool-list] state empty — "No MCP tools described yet." with the describe-first-tool hint', async () => {
    state.tools = [];
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe('No MCP tools described yet.');
    expect(empty.hint).toBe('Describe the first tool of a server to get started.');
    expect(MCP_TOOL_LIST_EMPTY_TITLE).toBe(empty.title);
    expect(MCP_TOOL_LIST_EMPTY_HINT).toBe(empty.hint);
    expect(container.textContent).toContain('No MCP tools described yet.');
    expect(container.textContent).toContain('Describe the first tool of a server to get started.');
  });

  it('[entity:mcp-tool-list] state no-results — tools exist but none matches the search: "No matching MCP tools."', async () => {
    state.tools = [sampleTool()];
    state.search = { q: 'no-such-tool' };
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe('No matching MCP tools.');
    expect(empty.hint).toBe('Try clearing the search or tag filter.');
    expect(MCP_TOOL_LIST_NO_RESULTS_TITLE).toBe(empty.title);
    expect(MCP_TOOL_LIST_NO_RESULTS_HINT).toBe(empty.hint);
    expect(container.textContent).not.toContain('No MCP tools described yet.');
  });

  it('[entity:mcp-tool-list] state no-results — the tag filter matching nothing shows the same no-results state', async () => {
    state.tools = [sampleTool({ tags: ['srv-docs'] })];
    state.search = { tag: 'srv-git' };
    await render(createElement(routeTable().get('/mcp-tools')!.component));
    expect(state.emptyStates.at(-1)?.title).toBe('No matching MCP tools.');
  });

  it('[entity:mcp-tool-list] has no error state and keeps the recorded query-key debt (outside the host prefixes, no WS subscription)', () => {
    const routesSrc = read(FRONTEND_SRC, 'routes.tsx');
    expect(routesSrc).not.toMatch(/isError|Failed to load|Something went wrong/i);
    const hooksSrc = read(FRONTEND_SRC, 'hooks.ts');
    // `['mcp-tool', 'list', q]` / `['mcp-tool', 'detail', slug]` — not under
    // `['mcp-tools']`, `['mcp-tool', slug]` or `['entities']`.
    expect(hooksSrc).toMatch(/list: \(q: McpToolListQuery\) => \[MCP_TOOL_TYPE, 'list', q\]/);
    expect(hooksSrc).toMatch(/detail: \(slug: string\) => \[MCP_TOOL_TYPE, 'detail', slug\]/);
    const all = [
      ...readdirSync(FRONTEND_SRC).map((f) => read(FRONTEND_SRC, f)),
      ...readdirSync(FRONTEND_KIT_SRC).map((f) => read(FRONTEND_KIT_SRC, f)),
    ].join('\n');
    expect(all).not.toMatch(/entity:changed|entity:indexed|useEntityChanged/);
  });
});

describe('[entity:mcp-tool-detail] /mcp-tools/:slug', () => {
  it('[entity:mcp-tool-detail] is registered under /mcp-tools/$slug and renders the breadcrumb (list label, tool name) with the Details / History switcher, a Delete in the meta strip — no Edit', async () => {
    const detail = routeTable().get('/mcp-tools/$slug');
    expect(detail).toBeDefined();
    await render(createElement(detail!.component));

    const crumb = buttonByText('MCP Tools');
    expect(crumb).toBeDefined();
    expect(crumb!.parentElement!.textContent).toMatch(/MCP Tools.*read_page$/);
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(['Details', 'History']);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Details');
    expect(
      Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Delete'),
    ).toHaveLength(1);
    expect(buttonByText('Edit')).toBeUndefined();
    // Meta strip: slug · updated … · Delete
    const meta = buttonByText('Delete')!.parentElement!;
    expect(meta.textContent).toContain('docs-read-page');
    expect(meta.textContent).toContain('updated');
    // The panel body: contract and logic are both on screen.
    expect(container.textContent).toContain('Contract');
    expect(container.textContent).toContain('Logic');
  });

  it('[entity:mcp-tool-detail] the History tab switches to the history route', async () => {
    await render(createElement(routeTable().get('/mcp-tools/$slug')!.component));
    await act(async () => {
      (Array.from(container.querySelectorAll('[role="tab"]')).find(
        (t) => t.textContent === 'History',
      ) as HTMLElement).click();
    });
    expect(state.navigate.at(-1)).toMatchObject({
      to: '/mcp-tools/$slug/history',
      params: { slug: 'docs-read-page' },
    });
  });

  it('[entity:mcp-tool-detail] Delete asks "Delete this tool?" through the host confirmDestructive window and, confirmed, deletes and returns to the list', async () => {
    await render(createElement(routeTable().get('/mcp-tools/$slug')!.component));
    await act(async () => {
      buttonByText('Delete')!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(confirmEvents).toHaveLength(1);
    expect(confirmEvents[0]).toMatchObject({ kind: 'mcp-tool-delete', title: 'Delete this tool?', danger: true });
    // No plugin-local dialog was drawn for it.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(state.deleted).toEqual(['docs-read-page']);
    expect(state.navigate.at(-1)).toMatchObject({ to: '/mcp-tools' });
  });

  it('[entity:mcp-tool-detail] state not-found — a 404 shows "No MCP tool at `{slug}`." and no form', async () => {
    state.tool = null;
    state.params = { slug: 'ghost' };
    await render(createElement(routeTable().get('/mcp-tools/$slug')!.component));
    expect(container.textContent).toContain('No MCP tool at ghost.');
    expect(container.querySelector('code')?.textContent).toBe('ghost');
    expect(buttonByText('Delete')).toBeUndefined();
    // Not retried: only a non-404 failure is retried by the detail query.
    const hooksSrc = read(FRONTEND_SRC, 'hooks.ts');
    expect(hooksSrc).toMatch(/status === 404\) return null;\s*throw err;/);
    expect(hooksSrc).toMatch(/retry: \(count, err\) => \(err as \{ status\?: number \}\)\.status !== 404 && count < 3/);
  });

  it('[entity:mcp-tool-detail] state load-failed — a non-404 failure shows red "Failed to load: {message}"', async () => {
    state.tool = undefined;
    state.toolError = new Error('Internal Server Error');
    await render(createElement(routeTable().get('/mcp-tools/$slug')!.component));
    const text = container.textContent ?? '';
    expect(text).toContain('Failed to load: Internal Server Error');
    expect(text).not.toContain('No MCP tool at');
    const msg = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent === 'Failed to load: Internal Server Error',
    ) as HTMLElement;
    expect(msg).toBeDefined();
    // Red text: the message is drawn in the theme's red ink.
    expect(read(FRONTEND_SRC, 'detail-panel.tsx')).toMatch(
      /style=\{\{ color: 'var\(--c-red\)' \}\}>\s*Failed to load: \{\(error as Error\)\.message\}/,
    );
  });
});

describe('[entity:mcp-tool-history] /mcp-tools/:slug/history', () => {
  it('[entity:mcp-tool-history] is registered under /mcp-tools/$slug/history and renders EntityVersionHistoryView for the type and slug', async () => {
    const history = routeTable().get('/mcp-tools/$slug/history');
    expect(history).toBeDefined();
    await render(createElement(history!.component));

    const view = state.historyViews.at(-1)!;
    expect(view.type).toBe('mcp-tool');
    expect(view.slug).toBe('docs-read-page');
    expect(buttonByText('MCP Tools')).toBeDefined();
    const active = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(active?.textContent).toBe('History');
  });

  it('[entity:mcp-tool-history] a successful Restore goes back to the Details view of the tool', async () => {
    await render(createElement(routeTable().get('/mcp-tools/$slug/history')!.component));
    await act(async () => {
      buttonByText('Restore')!.click();
    });
    expect(state.navigate.at(-1)).toMatchObject({
      to: '/mcp-tools/$slug',
      params: { slug: 'docs-read-page' },
      replace: true,
    });
  });
});

describe('[section:atmxa1s8] manifest sidebarTab', () => {
  it('[section:atmxa1s8] the ELEMENTS tab declares icon, label "MCP Tools" and order 8 — emptyState is unset', () => {
    const tab = mcpToolFrontendModule.sidebarTab!;
    expect(tab).toBeDefined();
    expect(tab.icon).toBeDefined();
    expect(tab.label).toBe('MCP Tools');
    expect(tab.order).toBe(8);
    expect('emptyState' in tab).toBe(false);
  });
});

describe('[section:h054mgoe] Host UI Kit slice', () => {
  it('[section:h054mgoe] the package consumes exactly the catalog components the slice lists, and keeps EntityBreadcrumbBar as local debt', () => {
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
        'GroupedEntityList',
        'TagFilterBar',
        'LoadingState',
        'EmptyState',
        'SegmentedControlTabs',
        'FieldGrid',
        'FieldRow',
        'TagPicker',
        'DocEditor',
        'EntityVersionHistoryView',
        'Dialog',
        'FormShell',
        'FormField',
        'ActionButton',
      ].sort(),
    );
    // DEBT: the breadcrumb bar is a package-local component on SegmentedControlTabs,
    // not the catalog's DetailPanelShell.
    const bar = read(FRONTEND_KIT_SRC, 'EntityBreadcrumbBar.tsx');
    expect(bar).toMatch(/export function EntityBreadcrumbBar\b/);
    expect(bar).toMatch(/<SegmentedControlTabs/);
    expect(bar).not.toMatch(/DetailPanelShell\s*[,}]/);
  });
});
