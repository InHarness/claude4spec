// @vitest-environment happy-dom
/**
 * 2.1.16 — the `dto` type's own detail and list screens (M13 detail pattern,
 * M19 list pattern, L12 Host UI Kit).
 *
 *  - `dto-detail` (`/dtos/:slug`): the route renders breadcrumb + view switcher
 *    + Delete (host confirmation window `dto-delete`), no Edit button; fields
 *    edit in place; tags are a `collapsed` `TagPicker` whose new name goes to
 *    the entity's draft and is saved with it (no tag created up front, no
 *    `TagCreatePopover`).
 *  - `dto-list` (`/dtos`): `EntityListHeader` (title, count, search, "New DTO")
 *    inside `EntityListLayout`; states `loading` and `empty` (one `EmptyState`,
 *    no reset).
 *  - sidebar tab without `emptyState`; chip / card with their own deleted-entity
 *    branch.
 *
 * The kit components are the host's real ones (`src/client/host-ui-kit/**`);
 * only the data hooks, the router and the live plugin host are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type FC, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Dto } from '../../src/types.js';

const state = vi.hoisted(() => ({
  dto: null as unknown,
  dtos: [] as unknown[],
  dtosLoading: false,
  params: { slug: 'user-response' } as Record<string, string>,
  search: {} as Record<string, string>,
  navigate: [] as unknown[],
  updates: [] as Array<{ slug: string; input: Record<string, unknown> }>,
  deleted: [] as string[],
  modules: [] as Array<Record<string, unknown>>,
  tagPickers: [] as Array<{ variant?: string; onCreate?: (name: string) => void; selected: string[] }>,
  headers: [] as Array<{ count?: number; title: string; search?: string }>,
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

vi.mock('@c4s/plugin-runtime', () => ({
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
}));

vi.mock('@c4s/plugin-runtime/ui', async () => {
  const { createElement: h } = await import('react');
  const [tagMod, badgeMod, rowMod, gridMod, btnMod, hdrMod, layoutMod, emptyMod, loadMod, listRowMod, tagBarMod, popMod] =
    await Promise.all([
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
    Badge: badgeMod.Badge,
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
    // The description editor: a plain textarea stands in for the ProseMirror one.
    DocEditor: ({ value }: { value: string }) => h('textarea', { 'aria-label': 'Description', defaultValue: value }),
    // Not rendered by these cases.
    EntityVersionHistoryView: () => null,
    Dialog: Passthrough,
    FormShell: Passthrough,
    FormField: Passthrough,
  };
});

vi.mock('../../src/entity/dto/frontend/monaco-json-editor.js', () => ({
  MonacoJsonEditor: () => null,
}));

vi.mock('../../src/entity/dto/frontend/hooks.js', () => ({
  useDto: () => ({ data: state.dto ?? undefined, isLoading: false, error: null }),
  useDtos: () => ({
    data: state.dtosLoading ? undefined : state.dtos,
    isLoading: state.dtosLoading,
  }),
  useUpdateDto: () => ({
    isPending: false,
    mutateAsync: async ({ slug, input }: { slug: string; input: Record<string, unknown> }) => {
      state.updates.push({ slug, input });
      return { ...(state.dto as object), ...input };
    },
  }),
  useDeleteDto: () => ({
    isPending: false,
    mutateAsync: async (slug: string) => {
      state.deleted.push(slug);
      return { deleted: true };
    },
  }),
  useCreateDto: () => ({ isPending: false, mutateAsync: async () => state.dto }),
}));

import { dtoRoutes } from '../../src/entity/dto/frontend/routes.js';
import { DtosList, DTO_LIST_EMPTY_TITLE } from '../../src/entity/dto/frontend/list-page.js';
import { dtoFrontendModule } from '../../src/entity/dto/frontend/module.js';
import { deleteDtoBody } from '../../src/entity/dto/frontend/delete-confirm.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND_SRC = join(import.meta.dirname, '../../src/entity/dto/frontend');
const detailSrc = readFileSync(join(FRONTEND_SRC, 'detail-panel.tsx'), 'utf-8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleDto(over: Partial<Dto> = {}): Dto {
  return {
    slug: 'user-response',
    title: 'UserResponse',
    description: 'What the API answers for a user.',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
    ],
    examples: [],
    tags: [],
    createdAt: '2026-10-10 10:00:00',
    updatedAt: '2026-10-10 10:00:00',
    ...over,
  } as Dto;
}

function mod(type: string, label: string, labelPlural: string, pathPrefix: string) {
  return { type, label, labelPlural, pathPrefix };
}

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  state.dto = sampleDto();
  state.dtos = [];
  state.dtosLoading = false;
  state.params = { slug: 'user-response' };
  state.search = {};
  state.navigate = [];
  state.updates = [];
  state.deleted = [];
  state.modules = [mod('dto', 'DTO', 'DTOs', '/dtos'), mod('endpoint', 'Endpoint', 'Endpoints', '/endpoints')];
  state.tagPickers = [];
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function routeTable() {
  const routes = dtoRoutes({ rootRoute: {} } as never) as unknown as Array<{
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

describe('[entity:dto-detail] /dtos/:slug', () => {
  it('[entity:dto-detail] is registered under /dtos/$slug and renders breadcrumb, view switcher, Delete — no Edit; fields edit in place', async () => {
    const routes = routeTable();
    // url `/dtos/:slug` — TanStack spells the path param `$slug`.
    const detail = routes.get('/dtos/$slug');
    expect(detail).toBeDefined();
    expect(routes.has('/dtos/$slug/history')).toBe(true);

    await render(createElement(detail!.component));

    const text = container.textContent ?? '';
    // Breadcrumb: list label + the DTO.
    expect(buttonByText('DTOs', container)).toBeDefined();
    expect(text).toContain('UserResponse');
    // View switcher (details / history).
    expect(buttonByText('Details', container)).toBeDefined();
    expect(buttonByText('History', container)).toBeDefined();
    // Delete on the route's toolbar — exactly one; no Edit button anywhere.
    expect(Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Delete')).toHaveLength(1);
    expect(buttonByText('Edit', container)).toBeUndefined();
    // Fields edit in place: the title and each field are inputs on the page.
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.some((i) => i.value === 'UserResponse')).toBe(true);
    expect(inputs.some((i) => i.value === 'email')).toBe(true);
    // Examples section with its empty text.
    expect(text).toContain('No examples yet');
    // Tags: `TagPicker` in the `collapsed` variant.
    expect(state.tagPickers.at(-1)?.variant).toBe('collapsed');
  });

  it('[entity:dto-detail] Delete asks through the host confirmation window (dto-delete), then goes to the list', async () => {
    const onConfirm = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; title: string; body: string; onConfirm: () => void };
      state.confirms.push(d);
      d.onConfirm();
    };
    window.addEventListener('c4s:confirm-open', onConfirm);
    try {
      await render(createElement(routeTable().get('/dtos/$slug')!.component));
      await act(async () => {
        buttonByText('Delete', container)!.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(state.confirms).toHaveLength(1);
      expect(state.confirms[0]!.kind).toBe('dto-delete');
      expect(state.confirms[0]!.title).toBe('Delete DTO?');
      expect(state.confirms[0]!.body).toBe(deleteDtoBody('UserResponse'));
      expect(state.deleted).toEqual(['user-response']);
      expect(state.navigate.at(-1)).toMatchObject({ to: '/dtos' });
    } finally {
      window.removeEventListener('c4s:confirm-open', onConfirm);
    }
  });

  it('[entity:dto-detail] a new tag name goes to the entity draft and is sent with the entity save — no tag created up front, no TagCreatePopover', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await render(createElement(routeTable().get('/dtos/$slug')!.component));
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
      expect(state.updates.at(-1)?.slug).toBe('user-response');
      expect(state.updates.at(-1)?.input.tags).toEqual(['auth-layer']);
      // Nothing created the tag on its own (no POST to the tags API).
      const tagPosts = fetchSpy.mock.calls.filter(([url, init]) =>
        String(url).includes('/tags') && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(tagPosts).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
    // The shared create popover is not used by the DTO detail.
    expect(detailSrc).not.toMatch(/TagCreatePopover/);
  });

  it('[entity:dto-detail] the sidebar tab carries no emptyState', () => {
    expect(dtoFrontendModule.sidebarTab).toBeDefined();
    expect(dtoFrontendModule.sidebarTab!.label).toBe('DTOs');
    expect('emptyState' in dtoFrontendModule.sidebarTab!).toBe(false);
  });

  it('[entity:dto-detail] chip: a clickable "⚠ {slug}" button; card: a non-clickable broken frame', async () => {
    const Chip = dtoFrontendModule.renderChip as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const Card = dtoFrontendModule.renderCard as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const opened: string[] = [];
    await render(
      createElement('div', null,
        createElement(Chip, { slug: 'dto-gone', entity: null, onOpen: () => opened.push('chip') }),
        createElement(Card, { slug: 'dto-gone', entity: null, onOpen: () => opened.push('card') }),
      ),
    );
    const chip = buttonByText('⚠ dto-gone', container);
    expect(chip).toBeDefined();
    await act(async () => chip!.click());
    expect(opened).toEqual(['chip']);
    expect(container.textContent).toContain('⚠ broken: dto "dto-gone"');
    const frames = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('broken: dto'),
    );
    expect(frames).toHaveLength(0);
  });
});

describe('[entity:dto-list] /dtos', () => {
  it('[entity:dto-list] is registered under /dtos and renders EntityListHeader (title, count, search, New DTO) with rows', async () => {
    const list = routeTable().get('/dtos');
    expect(list).toBeDefined();
    state.dtos = [
      sampleDto(),
      sampleDto({ slug: 'order-request', title: 'OrderRequest', description: 'An order.', fields: [] }),
    ];
    await render(createElement(list!.component));

    const header = state.headers.at(-1)!;
    expect(header.title).toBe('DTOs');
    // Count = length of the fetched list.
    expect(header.count).toBe(2);
    expect(container.textContent).toContain('2 results');
    // Search box present.
    expect(header.search).toBe('');
    expect(container.querySelector('input[placeholder^="Search"]')).not.toBeNull();
    // "New …" action.
    expect(buttonByText('New DTO', container)).toBeDefined();
    // Rows: title + field-count badge + description.
    const text = container.textContent ?? '';
    expect(text).toContain('UserResponse');
    expect(text).toContain('OrderRequest');
    expect(text).toContain('2f');
    expect(text).toContain('An order.');
    // No pagination, no error state.
    expect(text).not.toMatch(/Page \d+ of/);
    expect(state.loadingStates).toBe(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:dto-list] state loading — a LoadingState stands in for the rows', async () => {
    state.dtosLoading = true;
    await render(createElement(routeTable().get('/dtos')!.component));
    expect(state.loadingStates).toBeGreaterThan(0);
    expect(state.emptyStates).toHaveLength(0);
  });

  it('[entity:dto-list] state empty — one EmptyState with the type text and no filter reset', async () => {
    state.dtos = [];
    await render(
      createElement(DtosList, {
        search: 'nothing-matches',
        tagFilter: [],
        onSearchChange: () => undefined,
        onTagToggle: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(state.emptyStates.length).toBeGreaterThan(0);
    const empty = state.emptyStates.at(-1)!;
    expect(empty.title).toBe(DTO_LIST_EMPTY_TITLE);
    expect(empty.action).toBeUndefined();
    expect(container.textContent).toContain(DTO_LIST_EMPTY_TITLE);
    expect(container.textContent).not.toMatch(/clear filters|reset|Create your first DTO/i);
  });
});
