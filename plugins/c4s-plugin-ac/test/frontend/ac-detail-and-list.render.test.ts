// @vitest-environment happy-dom
/**
 * 2.1.16 — the `ac` envelope's own detail and list screens (M13 detail
 * pattern, M19 list pattern, L12 Host UI Kit).
 *
 *  - `ac-detail` (`/acs/:slug`): the route renders breadcrumb + view switcher +
 *    Delete, no Edit button, no deprecated banner; `kind` and `status` are
 *    `EnumBadgePicker`s; `verifies` is a `GroupedRelationPicker` with one group
 *    per registered type, dead targets as a `broken` `Badge`; tags a
 *    `collapsed` `TagPicker`.
 *  - `ac-list` (`/acs`): `EntityListHeader` with `status` and `kind` filters
 *    side by side, states `loading` and `empty` (one `EmptyState`, no reset).
 *  - create / edit windows: Kind (and Status in edit) through `EnumBadgePicker`.
 *  - chip / card: their own deleted-entity branch.
 *
 * The kit components are the host's real ones (`src/client/host-ui-kit/**`);
 * only the data hooks, the router and the live plugin host are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type FC, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Ac } from '../../src/types.js';

const state = vi.hoisted(() => ({
  ac: null as unknown,
  acs: [] as unknown[],
  acsLoading: false,
  params: { slug: 'ac-sample' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  updates: [] as Array<{ slug: string; input: Record<string, unknown> }>,
  modules: [] as Array<Record<string, unknown>>,
  enumPickers: [] as Array<{ options: Array<{ value: string }>; value: string }>,
  relationPickers: [] as Array<{ groups: Array<{ key: string; label: string }> }>,
  tagPickers: [] as Array<{ variant?: string }>,
  badges: [] as Array<{ label: unknown; variant?: string }>,
  headers: [] as Array<{ filters?: unknown; count?: number; title: string }>,
  emptyStates: [] as Array<{ title: string; hint?: unknown; action?: unknown }>,
  loadingStates: 0,
  confirms: [] as Array<{ kind: string; title: string; body: string }>,
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
    startSeededThread: () => undefined,
    EditorBridgeProvider: ({ children }: { children: ReactNode }) => children,
    queryClient: null,
  };
});

// Records the `Badge`s the package itself renders through `/ui` (the factory
// below hands this module's `Badge` out as the `/ui` export). It does NOT see
// the chips drawn INSIDE kit components (`EntityListRow`, `TagPicker`): their
// static `../actions/Badge.js` import is resolved by the module runner to
// `Badge.tsx`, while this mock is registered under the `.js` specifier, so the
// two never meet (system verification 2.1.28 round 2). Chips drawn by kit
// components are asserted in the rendered DOM instead — see `kitBadgeLabels`.
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
  const [enumMod, grpMod, tagMod, badgeMod, rowMod, gridMod, btnMod, barMod, segMod, hdrMod, layoutMod, emptyMod, loadMod, listRowMod, tagBarMod, popMod] =
    await Promise.all([
      import('../../../../src/client/host-ui-kit/pickers/EnumBadgePicker.js'),
      import('../../../../src/client/host-ui-kit/pickers/GroupedRelationPicker.js'),
      import('../../../../src/client/host-ui-kit/detail/TagPicker.js'),
      import('../../../../src/client/host-ui-kit/actions/Badge.js'),
      import('../../../../src/client/host-ui-kit/core/FieldRow.js'),
      import('../../../../src/client/host-ui-kit/core/FieldGrid.js'),
      import('../../../../src/client/host-ui-kit/actions/ActionButton.js'),
      import('../../../../src/client/host-ui-kit/actions/ActionBar.js'),
      import('../../../../src/client/host-ui-kit/detail/SegmentedControlTabs.js'),
      import('../../../../src/client/host-ui-kit/core/EntityListHeader.js'),
      import('../../../../src/client/host-ui-kit/list/EntityListLayout.js'),
      import('../../../../src/client/host-ui-kit/list/EmptyState.js'),
      import('../../../../src/client/host-ui-kit/actions/LoadingState.js'),
      import('../../../../src/client/host-ui-kit/list/EntityListRow.js'),
      import('../../../../src/client/host-ui-kit/list/TagFilterBar.js'),
      import('../../../../src/client/host-ui-kit/overlay-feedback/Popover.js'),
    ]);
  const spy =
    <P,>(Real: FC<P>, sink: (p: P) => void): FC<P> =>
    (p: P) => {
      sink(p);
      return h(Real as FC<P>, p as never);
    };
  const Passthrough = ({ children }: { children?: ReactNode }) => h('div', null, children);
  return {
    EnumBadgePicker: spy(enumMod.EnumBadgePicker, (p) => state.enumPickers.push(p as never)),
    GroupedRelationPicker: spy(grpMod.GroupedRelationPicker, (p) => state.relationPickers.push(p as never)),
    TagPicker: spy(tagMod.TagPicker, (p) => state.tagPickers.push(p as never)),
    // Already recorded by the mock of the kit's Badge module above.
    Badge: badgeMod.Badge,
    FieldRow: rowMod.FieldRow,
    FieldGrid: gridMod.FieldGrid,
    ActionButton: btnMod.ActionButton,
    ActionBar: barMod.ActionBar,
    SegmentedControlTabs: segMod.SegmentedControlTabs,
    EntityListHeader: spy(hdrMod.EntityListHeader, (p) => state.headers.push(p as never)),
    EntityListLayout: layoutMod.EntityListLayout,
    EmptyState: spy(emptyMod.EmptyState, (p) => state.emptyStates.push(p as never)),
    LoadingState: spy(loadMod.LoadingState, () => {
      state.loadingStates += 1;
    }),
    EntityListRow: listRowMod.EntityListRow,
    TagFilterBar: tagBarMod.TagFilterBar,
    Popover: popMod.Popover,
    // Not rendered by these cases.
    EntityVersionHistoryView: () => null,
    Dialog: Passthrough,
    FormShell: Passthrough,
    FormField: Passthrough,
  };
});

vi.mock('../../src/entity/ac/frontend/hooks.js', () => ({
  keys: {
    all: ['acs'],
    list: (q: unknown) => ['acs', 'list', q],
    detail: (slug: string) => ['ac', slug],
  },
  useAc: () => ({ data: state.ac ?? undefined, isLoading: false, error: null }),
  useAcs: (q: { status?: string } = {}) => ({
    data: state.acsLoading ? undefined : state.acs,
    isLoading: state.acsLoading,
    q,
  }),
  useUpdateAc: () => ({
    isPending: false,
    mutateAsync: async ({ slug, input }: { slug: string; input: Record<string, unknown> }) => {
      state.updates.push({ slug, input });
      return { ...(state.ac as object), ...input };
    },
  }),
  useDeleteAc: () => ({ isPending: false, mutateAsync: async () => ({ deleted: true }) }),
  useCreateAc: () => ({ isPending: false, mutateAsync: async () => state.ac }),
}));

import { acRoutes } from '../../src/entity/ac/frontend/routes.js';
import { AcDetail } from '../../src/entity/ac/frontend/detail-panel.js';
import { AcsList, AC_LIST_EMPTY_TITLE } from '../../src/entity/ac/frontend/list-page.js';
import { AcEditForm } from '../../src/entity/ac/frontend/edit-popover.js';
import { acFrontendModule } from '../../src/entity/ac/frontend/module.js';
import { deleteAcBody } from '../../src/entity/ac/frontend/delete-confirm.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkSlotShapes } from '../../../../src/client/core/plugin-host/slot-rules.js';

const FRONTEND_SRC = join(import.meta.dirname, '../../src/entity/ac/frontend');
const create = readFileSync(join(FRONTEND_SRC, 'create-dialog.tsx'), 'utf-8');
const slash = readFileSync(join(FRONTEND_SRC, 'slash-create.tsx'), 'utf-8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO_ROOT = join(import.meta.dirname, '../../../..');
// 2.1.39: the value marker and the tag chip are two components, each with its own class.
const BADGE_MARKUP = 'value-badge';
const TAG_CHIP_MARKUP = 'tag-chip';

/**
 * Labels of every value marker the kit `Badge` drew in `scope`, read from the
 * rendered DOM: a Badge is a `<span>` carrying the `value-badge` class, its
 * text is the label. This sees badges drawn inside kit components, which no
 * module mock of `Badge` reaches.
 */
function kitBadgeLabels(scope: ParentNode): string[] {
  return [...scope.querySelectorAll(`span.${BADGE_MARKUP}`)].map((el) => (el.textContent ?? '').trim());
}

/** Labels of every tag chip the kit `TagChip` drew in `scope` (the `tag-chip` class; the dot is an empty span). */
function kitTagChipLabels(scope: ParentNode): string[] {
  return [...scope.querySelectorAll(`span.${TAG_CHIP_MARKUP}`)].map((el) => (el.textContent ?? '').trim());
}

/**
 * A marker class identifies its kit component only if no other component
 * emits it: among the TSX sources of the host client and of every plugin, the
 * kit's own file is the one that does.
 */
function expectMarkupOwnedOnlyBy(marker: string, owner: string): void {
  const owners: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx') && readFileSync(full, 'utf-8').includes(marker)) {
        owners.push(relative(REPO_ROOT, full).split('\\').join('/'));
      }
    }
  };
  walk(join(REPO_ROOT, 'src/client'));
  for (const pkg of readdirSync(join(REPO_ROOT, 'plugins'))) {
    const src = join(REPO_ROOT, 'plugins', pkg, 'src');
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      // a package without src/
    }
  }
  expect(owners).toEqual([owner]);
}

function sampleAc(over: Partial<Ac> = {}): Ac {
  return {
    slug: 'ac-sample',
    title: 'The endpoint answers 204 on success.',
    kind: 'requirement',
    status: 'active',
    verifies: [],
    tags: ['m07'],
    createdAt: '2026-10-10 10:00:00',
    updatedAt: '2026-10-10 10:00:00',
    ...over,
  } as Ac;
}

function mod(type: string, label: string, slugs: string[] = []) {
  return {
    type,
    label,
    labelPlural: `${label}s`,
    pathPrefix: `/${type}s`,
    listByTags: async () => slugs.map((slug) => ({ slug })),
  };
}

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  state.ac = sampleAc();
  state.acs = [];
  state.acsLoading = false;
  state.params = { slug: 'ac-sample' };
  state.search = {};
  state.navigate = [];
  state.updates = [];
  state.modules = [mod('ac', 'Acceptance Criterion'), mod('endpoint', 'Endpoint'), mod('dto', 'DTO')];
  state.enumPickers = [];
  state.relationPickers = [];
  state.tagPickers = [];
  state.badges = [];
  state.headers = [];
  state.emptyStates = [];
  state.loadingStates = 0;
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
  // Let `useQueries` resolve its candidate lists.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function routeTable() {
  const routes = acRoutes({ rootRoute: {} } as never) as unknown as Array<{
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

const lastPicker = (values: string[]) =>
  [...state.enumPickers]
    .reverse()
    .find((p) => JSON.stringify(p.options.map((o) => o.value)) === JSON.stringify(values));

describe('[entity:ac-detail] /acs/:slug', () => {
  it('[entity:ac-detail] is registered under /acs/$slug and renders breadcrumb, view switcher, Delete — no Edit, no deprecated banner', async () => {
    const routes = routeTable();
    // url `/acs/:slug` — TanStack spells the path param `$slug`.
    const detail = routes.get('/acs/$slug');
    expect(detail).toBeDefined();
    expect(routes.has('/acs/$slug/history')).toBe(true);

    state.ac = sampleAc({ status: 'deprecated' });
    await render(createElement(detail!.component));

    const text = container.textContent ?? '';
    // Breadcrumb: list label + the criterion.
    expect(text).toContain('Acceptance Criterions');
    expect(text).toContain('The endpoint answers 204 on success.');
    // View switcher (details / history).
    expect(container.querySelector('[role=tablist]')).not.toBeNull();
    // Delete on the route's toolbar; no Edit button anywhere.
    expect(buttonByText('Delete', container)).toBeDefined();
    expect(buttonByText('Edit', container)).toBeUndefined();
    // No deprecated banner — a deprecated criterion is a struck-through title.
    expect(text).not.toMatch(/This AC is deprecated/);
    const title = container.querySelector('textarea[aria-label="Title"]') as HTMLTextAreaElement;
    expect(title.value).toBe('The endpoint answers 204 on success.');
    expect(title.style.textDecoration).toBe('line-through');
    // Slug: a read-only badge under the title.
    expect(container.querySelector('[data-testid="ac-slug"]')?.textContent).toContain('ac-sample');
    // Tags: `TagPicker` in the `collapsed` variant.
    expect(state.tagPickers.at(-1)?.variant).toBe('collapsed');
    // Find references, empty.
    expect(text).toContain('Not referenced by any page.');
    // `verifies` has no drag handle / manual order.
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it('[entity:ac-detail] Delete asks through the host confirmation window (ac-delete), then goes to the list', async () => {
    const onConfirm = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; title: string; body: string; onConfirm: () => void };
      state.confirms.push(d);
      d.onConfirm();
    };
    window.addEventListener('c4s:confirm-open', onConfirm);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ references: [], total: 2 }), { status: 200 }));
    try {
      await render(createElement(routeTable().get('/acs/$slug')!.component));
      await act(async () => {
        buttonByText('Delete', container)!.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(state.confirms).toHaveLength(1);
      expect(state.confirms[0]!.kind).toBe('ac-delete');
      expect(state.confirms[0]!.body).toBe(deleteAcBody('ac-sample', 2));
      expect(state.navigate.at(-1)).toMatchObject({ to: '/acs' });
    } finally {
      window.removeEventListener('c4s:confirm-open', onConfirm);
      fetchSpy.mockRestore();
    }
  });

  it('[entity:ac-detail] the ac-delete sentence drops the reference clause at zero', () => {
    expect(deleteAcBody('ac-x', 0)).toBe(
      'Delete AC `ac-x`? This cannot be undone. Consider marking it as `deprecated` instead — this preserves history and references.',
    );
    expect(deleteAcBody('ac-x', 3)).toContain('3 page(s) reference this AC and will become broken.');
  });
});

describe('[ac:ac-pole-kind-na-stronie-detalu-ac-zmieni] kind on the AC detail page', () => {
  it('[ac:ac-pole-kind-na-stronie-detalu-ac-zmieni] Kind is an EnumBadgePicker (requirement / edge-case) and a pick is saved', async () => {
    await render(
      createElement(AcDetail, { slug: 'ac-sample', onRenamed: () => undefined }),
    );
    const picker = lastPicker(['requirement', 'edge-case']);
    expect(picker, 'EnumBadgePicker over the kind enum').toBeDefined();
    expect(picker!.value).toBe('requirement');
    // No radio buttons — the old control is gone.
    expect(container.querySelector('input[type=radio]')).toBeNull();

    await act(async () => {
      buttonByText('requirement', container)!.click();
    });
    await act(async () => {
      buttonByText('edge-case', container)!.click();
    });
    expect(lastPicker(['requirement', 'edge-case'])!.value).toBe('edge-case');
    // Autosave (debounced) carries the new kind.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(state.updates.at(-1)?.input.kind).toBe('edge-case');
  });
});

describe('[ac:ac-pole-status-na-stronie-detalu-ac-zmie] status on the AC detail page', () => {
  it('[ac:ac-pole-status-na-stronie-detalu-ac-zmie] Status is an EnumBadgePicker (active / deprecated) and a pick is saved', async () => {
    await render(
      createElement(AcDetail, { slug: 'ac-sample', onRenamed: () => undefined }),
    );
    const picker = lastPicker(['active', 'deprecated']);
    expect(picker, 'EnumBadgePicker over the status enum').toBeDefined();
    expect(picker!.value).toBe('active');

    await act(async () => {
      buttonByText('active', container)!.click();
    });
    await act(async () => {
      buttonByText('deprecated', container)!.click();
    });
    expect(lastPicker(['active', 'deprecated'])!.value).toBe('deprecated');
    // Deprecated → struck-through title, no banner.
    const title = container.querySelector('textarea[aria-label="Title"]') as HTMLTextAreaElement;
    expect(title.style.textDecoration).toBe('line-through');
    expect(container.textContent).not.toMatch(/This AC is deprecated/);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(state.updates.at(-1)?.input.status).toBe('deprecated');
  });
});

describe('[ac:ac-panel-verifies-na-stronie-detalu-ac-g] verifies panel on the AC detail page', () => {
  it('[ac:ac-panel-verifies-na-stronie-detalu-ac-g] one group per registered type, targets grouped by their type', async () => {
    state.modules = [
      mod('ac', 'Acceptance Criterion'),
      mod('endpoint', 'Endpoint', ['get-users']),
      mod('dto', 'DTO', ['user-dto']),
      mod('ui-view', 'UI View'),
    ];
    state.ac = sampleAc({
      verifies: [
        { type: 'endpoint', slug: 'get-users' },
        { type: 'dto', slug: 'user-dto' },
      ],
    });
    await render(
      createElement(AcDetail, {
        slug: 'ac-sample',
        onRenamed: () => undefined,
        onOpenEntity: () => undefined,
      }),
    );

    const props = state.relationPickers.at(-1)!;
    // One group per type in the registry — `ac` included — in registry order.
    expect(props.groups.map((g) => g.key)).toEqual(['ac', 'endpoint', 'dto', 'ui-view']);
    expect(props.groups.map((g) => g.label)).toEqual(['Acceptance Criterion', 'Endpoint', 'DTO', 'UI View']);
    // Each target sits in its own type's group.
    expect((props as unknown as { selected: Record<string, string[]> }).selected).toEqual({
      endpoint: ['get-users'],
      dto: ['user-dto'],
    });
    const text = container.textContent ?? '';
    for (const label of ['Acceptance Criterion', 'Endpoint', 'DTO', 'UI View']) expect(text).toContain(label);
    // Valid targets get the "open" link — a ghost `ActionButton`, a real
    // Tab-reachable button (2.1.40) — not a broken badge.
    const open = buttonByText('open', container);
    expect(open).toBeDefined();
    expect(open!.tagName).toBe('BUTTON');
    expect(open!.tabIndex).toBe(0);
    expect(state.badges.filter((b) => b.variant === 'broken')).toHaveLength(0);
  });

  it('[entity:ac-detail] a dead verifies target renders as a broken Badge', async () => {
    state.ac = sampleAc({ verifies: [{ type: 'endpoint', slug: 'gone-endpoint' }] });
    await render(createElement(AcDetail, { slug: 'ac-sample', onRenamed: () => undefined }));
    const broken = state.badges.filter((b) => b.variant === 'broken');
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.at(-1)!.label).toBe('missing');
  });
});

describe('[entity:ac-list] /acs', () => {
  it('[entity:ac-list] is registered under /acs and renders the header with status and kind filters side by side', async () => {
    const list = routeTable().get('/acs');
    expect(list).toBeDefined();
    state.acs = [sampleAc(), sampleAc({ slug: 'ac-two', title: 'Second criterion.', kind: 'edge-case' })];
    await render(createElement(list!.component));

    const header = state.headers.at(-1)!;
    expect(header.title).toBe('Acceptance Criteria');
    // Count = length of the fetched list.
    expect(header.count).toBe(2);
    // Both filters in the header's `filters` slot, next to each other.
    const filters = container.querySelector('[data-testid="ac-list-filters"]')!;
    const tablists = filters.querySelectorAll('[role=tablist]');
    expect(tablists).toHaveLength(2);
    expect(tablists[0]!.textContent).toContain('Active');
    expect(tablists[0]!.textContent).toContain('Deprecated');
    expect(tablists[1]!.textContent).toContain('Requirement');
    expect(tablists[1]!.textContent).toContain('Edge case');
    // "New …" action.
    expect(buttonByText('New AC', container)).toBeDefined();
    // Rows.
    expect(container.textContent).toContain('Second criterion.');
    // No pagination.
    expect(container.textContent).not.toMatch(/Page \d+ of/);
  });

  it('[entity:ac-list] state loading — a LoadingState stands in for the rows', async () => {
    state.acsLoading = true;
    await render(createElement(routeTable().get('/acs')!.component));
    expect(state.loadingStates).toBeGreaterThan(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:ac-list] state empty — one EmptyState with the type text and no filter reset', async () => {
    state.acs = [];
    await render(
      createElement(AcsList, {
        search: 'nothing-matches',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(state.emptyStates.length).toBeGreaterThan(0);
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe(AC_LIST_EMPTY_TITLE);
    expect(empty.action).toBeUndefined();
    expect(container.textContent).toContain(AC_LIST_EMPTY_TITLE);
    expect(container.textContent).not.toMatch(/clear filters|reset/i);
  });

  it('[entity:ac-list] 2.1.28 composition — rows are kit EntityListRows whose kind badge and deprecated-only status badge render through Badge and whose tag chips render through TagChip (2.1.39); the Analyze consistency action sits in the kit ActionBar', async () => {
    state.acs = [
      sampleAc({ slug: 'ac-one', title: 'Active one.', kind: 'requirement', tags: ['m07'] }),
      sampleAc({ slug: 'ac-old', title: 'Old one.', kind: 'edge-case', status: 'deprecated', tags: [] }),
    ];
    await render(
      createElement(AcsList, {
        search: '',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    // Read from the DOM: the kind / status badges come from the package through
    // `/ui` as the kit `Badge`'s markup, the tag chip from inside the kit
    // `EntityListRow` as the kit `TagChip`'s markup.
    expectMarkupOwnedOnlyBy(BADGE_MARKUP, 'src/client/host-ui-kit/actions/Badge.tsx');
    expectMarkupOwnedOnlyBy(TAG_CHIP_MARKUP, 'src/client/host-ui-kit/actions/TagChip.tsx');
    const labels = kitBadgeLabels(container);
    // kind badge on every row
    expect(labels).toContain('requirement');
    expect(labels).toContain('edge-case');
    // status badge only for the deprecated criterion (per-row check below)
    expect(labels).toContain('deprecated');
    expect(labels).not.toContain('active');
    // tag chip of the first row via TagChip (EntityListRow draws it), not a Badge
    expect(kitTagChipLabels(container)).toEqual(['m07']);
    expect(labels).not.toContain('m07');
    // the bespoke "· deprecated" text span is gone
    expect(container.textContent).not.toContain('· deprecated');
    const rowBadges = container.querySelectorAll('[data-testid="ac-row-badges"]');
    expect(rowBadges).toHaveLength(2);
    expect(rowBadges[0]!.textContent).not.toContain('deprecated');
    expect(rowBadges[1]!.textContent).toContain('deprecated');
    // ActionBar with the one action
    expect(buttonByText('Analyze consistency', container)).toBeDefined();
  });

  it('[ac:ac-wiersz-na-liscie-ac-pokazuje-title-be] a row on the AC list shows the title without the ~40-character cut', async () => {
    const long = 'A criterion whose title runs well past the forty characters a chip keeps.';
    state.acs = [sampleAc({ slug: 'ac-long', title: long })];
    await render(
      createElement(AcsList, {
        search: '',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(long.length).toBeGreaterThan(40);
    expect(container.textContent).toContain(long);
    expect(container.textContent).not.toContain('…');
  });

  it('[ac:ac-wiersz-na-liscie-ac-pokazuje-wszystki] a row on the AC list shows every tag chip of the criterion, with no "+N more" fold', async () => {
    const tags = ['t1', 't2', 't3', 't4', 't5'];
    state.acs = [sampleAc({ slug: 'ac-tagged', title: 'Tagged.', tags })];
    await render(
      createElement(AcsList, {
        search: '',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    const labels = kitTagChipLabels(container);
    for (const t of tags) expect(labels).toContain(t);
    expect(container.textContent).not.toMatch(/\+\d+ more/);
  });

  it('[entity:ac-list] with no active AC the Analyze consistency action is disabled with the "No active AC to analyze" tooltip', async () => {
    state.acs = [];
    await render(
      createElement(AcsList, {
        search: '',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    const btn = buttonByText('Analyze consistency', container)!;
    expect(btn).toBeDefined();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('No active AC to analyze');
  });
});

describe('[entity:ac-detail] create and edit windows', () => {
  it('[entity:ac-detail] ac-edit: Kind and Status are EnumBadgePickers, Remove opens ac-delete', async () => {
    await render(createElement(AcEditForm, { entity: sampleAc(), onClose: () => undefined }));
    expect(lastPicker(['requirement', 'edge-case'])?.value).toBe('requirement');
    expect(lastPicker(['active', 'deprecated'])?.value).toBe('active');
    expect(container.querySelector('input[type=radio]')).toBeNull();
    expect(buttonByText('Remove', container)).toBeDefined();
  });

  it('[entity:ac-detail] the create dialog and the /ac popover pick Kind through EnumBadgePicker, not radios', () => {
    for (const src of [create, slash]) {
      expect(src).toMatch(/<EnumBadgePicker\s+options=\{AC_KIND_OPTIONS\}/);
      expect(src).not.toMatch(/type="radio"/);
    }
  });
});

describe('[entity:ac-detail] chip and card — own deleted-entity branch', () => {
  it('[entity:ac-detail] chip: the broken Badge with the slug, not clickable (2.1.39, M13); card: a non-clickable broken frame', async () => {
    const Chip = acFrontendModule.renderChip as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const Card = acFrontendModule.renderCard as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const opened: string[] = [];
    await render(
      createElement('div', null,
        createElement(Chip, { slug: 'ac-gone', entity: null, onOpen: () => opened.push('chip') }),
        createElement(Card, { slug: 'ac-gone', entity: null, onOpen: () => opened.push('card') }),
      ),
    );
    // The chip is the catalog's broken Badge with the slug — no button, no onOpen.
    expect(state.badges.filter((b) => b.variant === 'broken').map((b) => b.label)).toEqual(['ac-gone']);
    const chip = container.querySelector<HTMLElement>(`span.${BADGE_MARKUP}`)!;
    expect(chip.textContent).toBe('⚠ac-gone');
    expect(chip.closest('button')).toBeNull();
    expect(chip.hasAttribute('tabindex')).toBe(false);
    await act(async () => chip.click());
    expect(opened).toEqual([]);
    expect(container.textContent).toContain('⚠ broken: ac "ac-gone"');
    // The card's broken frame is not a button.
    const frames = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('broken: ac'),
    );
    expect(frames).toHaveLength(0);
  });
});

/** Every `.ts`/`.tsx` file under `dir`, recursively — tests excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const PKG_SRC = join(import.meta.dirname, '../../src');
const KIT_SRC = join(PKG_SRC, 'frontend-kit');
const HOST_CLIENT_SRC = join(import.meta.dirname, '../../../../src/client');

describe('[section:fsu38c8q] manifest detailPanel slot — checked for shape, not rendered by the host', () => {
  it('[section:fsu38c8q] the manifest declares detailPanel: AcDetail together with routes, and the host slot check accepts it', () => {
    expect(acFrontendModule.detailPanel).toBe(AcDetail);
    expect(typeof acFrontendModule.routes).toBe('function');
    // The host checks the slot's shape (and the routes/detailPanel pair) — nothing more.
    expect(checkSlotShapes(acFrontendModule)).toBeNull();
    // A detailPanel that is not a component is what the shape check refuses.
    expect(
      checkSlotShapes({ ...acFrontendModule, detailPanel: {} as never }),
    ).toMatch(/'detailPanel' is declared but is not a React component/);
  });

  it('[section:fsu38c8q] the host never renders the slot — no host client file mounts a module\'s detailPanel', () => {
    const readers = sourceFiles(HOST_CLIENT_SRC)
      .filter((p) => /\.detailPanel\b/.test(readFileSync(p, 'utf-8')))
      .map((p) => relative(HOST_CLIENT_SRC, p).split('\\').join('/'))
      .sort();
    // Only the shape check and the legacy-def copy read the slot.
    expect(readers).toEqual(['core/plugin-host/legacy-adapter.ts', 'core/plugin-host/slot-rules.ts']);
    for (const p of sourceFiles(HOST_CLIENT_SRC)) {
      const src = readFileSync(p, 'utf-8');
      expect(src, p).not.toMatch(/<\s*[\w.]*detailPanel\b/i);
      expect(src, p).not.toMatch(/createElement\(\s*[\w.]*detailPanel\b/);
    }
  });

  it('[section:fsu38c8q] view behaviour is unchanged — the /acs/$slug route renders AcDetail itself', async () => {
    const routesSrc = readFileSync(join(FRONTEND_SRC, 'routes.tsx'), 'utf-8');
    expect(routesSrc).toMatch(/<AcDetail\b/);
    await render(createElement(routeTable().get('/acs/$slug')!.component));
    // The panel's own title editor is on the route's screen.
    const title = container.querySelector('textarea[aria-label="Title"]') as HTMLTextAreaElement | null;
    expect(title?.value).toBe('The endpoint answers 204 on success.');
  });
});

describe('[section:yrzqclyz] Host UI Kit slice', () => {
  it('[section:yrzqclyz] the package consumes exactly the catalog components the slice lists — DetailPanelShell, InlineEditField, Pagination, EntityDetailToolbar and Popover are not among them', () => {
    const consumed = new Set<string>();
    for (const p of sourceFiles(PKG_SRC)) {
      const src = readFileSync(p, 'utf-8');
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
        'Badge',
        'ActionBar',
        'SegmentedControlTabs',
        'FieldGrid',
        'FieldRow',
        'EnumBadgePicker',
        'GroupedRelationPicker',
        'TagPicker',
        'EntityVersionHistoryView',
        'Dialog',
        'FormShell',
        'FormField',
        'ActionButton',
        // 2.1.40: the renderRow slot draws the criterion's tags as TagChips.
        'TagChip',
      ].sort(),
    );
    for (const dropped of ['DetailPanelShell', 'InlineEditField', 'Pagination', 'EntityDetailToolbar', 'Popover']) {
      expect(consumed.has(dropped), dropped).toBe(false);
    }
  });

  it('[section:yrzqclyz] each host-local frontend-kit duplicate is recorded as DEBT naming its catalog replacement', () => {
    const debt: Array<[file: string, exports: string[], replacement: string | null]> = [
      ['EntityBreadcrumbBar.tsx', ['EntityBreadcrumbBar'], 'DetailPanelShell'],
      ['EntityNotFound.tsx', ['EntityNotFound'], 'EmptyState'],
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
    // Recorded, not fixed: the detail route still renders through the local bar.
    expect(readFileSync(join(FRONTEND_SRC, 'routes.tsx'), 'utf-8')).toMatch(/<EntityBreadcrumbBar\b/);
  });

  it('[section:yrzqclyz] EntityViewSwitcher is struck from the debts — a composition of SegmentedControlTabs only, with no DEBT header', () => {
    const src = readFileSync(join(KIT_SRC, 'EntityViewSwitcher.tsx'), 'utf-8');
    expect(src).not.toMatch(/DEBT \(/);
    expect(src).toMatch(/<SegmentedControlTabs\b/);
  });

  it('[section:yrzqclyz] ListPageHeader / ListScrollArea (struck from the slice in 2.1.20) are not carried by this package — the list composes their replacements directly', () => {
    const kit = readdirSync(KIT_SRC);
    expect(kit).not.toContain('ListPageHeader.tsx');
    expect(kit).not.toContain('ListScrollArea.tsx');
    const list = readFileSync(join(FRONTEND_SRC, 'list-page.tsx'), 'utf-8');
    for (const name of ['EntityListHeader', 'EntityListLayout', 'LoadingState', 'EmptyState']) {
      expect(list).toMatch(new RegExp(`<${name}\\b`));
    }
  });
});
