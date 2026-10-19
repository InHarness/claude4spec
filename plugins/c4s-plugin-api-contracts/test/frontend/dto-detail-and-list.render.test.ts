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

vi.mock('@c4s/plugin-runtime/ui', async () => {
  const { createElement: h } = await import('react');
  const [tagMod, badgeMod, rowMod, gridMod, btnMod, hdrMod, layoutMod, emptyMod, loadMod, listRowMod, tagBarMod, popMod, tagChipMod] =
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
    Badge: badgeMod.Badge,
    TagChip: tagChipMod.TagChip,
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

// The example value editor: a plain textarea stands in for Monaco, carrying
// its `readOnly` flag and `onChange` so the read / edit modes are observable.
vi.mock('../../src/entity/dto/frontend/monaco-json-editor.js', async () => {
  const { createElement: h } = await import('react');
  return {
    MonacoJsonEditor: ({
      value,
      onChange,
      readOnly = false,
    }: {
      value: string;
      onChange: (next: string) => void;
      readOnly?: boolean;
    }) =>
      h('textarea', {
        'data-testid': 'example-json',
        value,
        readOnly,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }),
  };
});

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
import { DtoDetail } from '../../src/entity/dto/frontend/detail-panel.js';
import { checkSlotShapes } from '../../../../src/client/core/plugin-host/slot-rules.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('[entity:dto-detail] chip: the broken Badge with the slug, not clickable (2.1.39, M13); card: a non-clickable broken frame', async () => {
    const Chip = dtoFrontendModule.renderChip as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const Card = dtoFrontendModule.renderCard as unknown as FC<{ slug: string; entity: null; onOpen: () => void }>;
    const opened: string[] = [];
    await render(
      createElement('div', null,
        createElement(Chip, { slug: 'dto-gone', entity: null, onOpen: () => opened.push('chip') }),
        createElement(Card, { slug: 'dto-gone', entity: null, onOpen: () => opened.push('card') }),
      ),
    );
    // The chip is the catalog's broken Badge with the slug — no button, no onOpen.
    const chip = container.querySelector<HTMLElement>('span.value-badge')!;
    expect(chip.textContent).toBe('⚠dto-gone');
    expect(chip.closest('button')).toBeNull();
    await act(async () => chip.click());
    expect(opened).toEqual([]);
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

// ─── 2.1.19 ───────────────────────────────────────────────────────────────

function exampleRows(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[draggable="true"]')) as HTMLElement[];
}

function jsonEditor(): HTMLTextAreaElement | null {
  return container.querySelector('textarea[data-testid="example-json"]');
}

async function typeJson(value: string) {
  await act(async () => {
    const el = jsonEditor()!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function settleAutosave() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700));
  });
}

/** Expand the example row whose header shows `name`. */
async function expandExample(name: string) {
  const label = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === name);
  expect(label, `example row ${name}`).toBeDefined();
  await click(label!);
}

describe('[entity:dto-detail] examples — value read-only by default, edit / Cancel / Save (2.1.19)', () => {
  it('[entity:dto-detail] an example value is read-only by default; the edit button switches it to editing with Cancel and Save', async () => {
    state.dto = sampleDto({
      examples: [{ name: 'minimal', summary: 'Smallest payload', value: { id: 'u1', email: 'a@b.c' } }],
    });
    await render(createElement(routeTable().get('/dtos/$slug')!.component));
    await expandExample('minimal');

    // Read mode: the editor is read-only, one edit button, no Cancel / Save.
    expect(jsonEditor()!.readOnly).toBe(true);
    expect(JSON.parse(jsonEditor()!.value)).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(buttonByText('Edit value', container)).toBeDefined();
    expect(buttonByText('Cancel', container)).toBeUndefined();
    expect(buttonByText('Save', container)).toBeUndefined();

    // Edit mode: writable, with Cancel and Save.
    await click(buttonByText('Edit value', container)!);
    expect(jsonEditor()!.readOnly).toBe(false);
    expect(buttonByText('Cancel', container)).toBeDefined();
    expect(buttonByText('Save', container)).toBeDefined();

    // Cancel drops the edit and goes back to read mode with the stored value.
    await typeJson('{"id":"changed"}');
    await click(buttonByText('Cancel', container)!);
    expect(jsonEditor()!.readOnly).toBe(true);
    expect(JSON.parse(jsonEditor()!.value)).toEqual({ id: 'u1', email: 'a@b.c' });
    await settleAutosave();
    expect(state.updates).toHaveLength(0);
  });

  it('[entity:dto-detail] Save validates JSON: invalid JSON stays in edit mode with "invalid JSON: …"; valid JSON is saved and the value returns to read mode', async () => {
    state.dto = sampleDto({
      examples: [{ name: 'minimal', value: { id: 'u1', email: 'a@b.c' } }],
    });
    await render(createElement(routeTable().get('/dtos/$slug')!.component));
    await expandExample('minimal');
    await click(buttonByText('Edit value', container)!);

    // Invalid JSON — Save is clickable (no save block), and the run stays in edit.
    await typeJson('{ "id": ');
    const save = buttonByText('Save', container)!;
    expect(save.disabled).toBe(false);
    await click(save);
    expect(jsonEditor()!.readOnly).toBe(false);
    expect(container.textContent).toContain('invalid JSON: ');
    await settleAutosave();
    expect(state.updates).toHaveLength(0);

    // Valid JSON — saved into `examples[]`, back to read mode, message gone.
    await typeJson('{"id":"u2","email":"x@y.z"}');
    await click(buttonByText('Save', container)!);
    expect(jsonEditor()!.readOnly).toBe(true);
    expect(container.textContent).not.toContain('invalid JSON');
    expect(JSON.parse(jsonEditor()!.value)).toEqual({ id: 'u2', email: 'x@y.z' });
    await settleAutosave();
    expect(state.updates.at(-1)?.input.examples).toEqual([
      { name: 'minimal', value: { id: 'u2', email: 'x@y.z' } },
    ]);
  });

  it('[entity:dto-detail] the field-compatibility warning is a soft banner shown only in read mode', async () => {
    state.dto = sampleDto({
      examples: [{ name: 'minimal', value: { id: 'u1', email: null } }],
    });
    await render(createElement(routeTable().get('/dtos/$slug')!.component));
    await expandExample('minimal');

    const banner = "Example doesn't match field `email`: expected string, got null";
    expect(container.textContent).toContain(banner);

    // Editing hides the warnings.
    await click(buttonByText('Edit value', container)!);
    expect(container.textContent).not.toContain("Example doesn't match field");

    // Soft: a value that still mismatches saves anyway, and the banner is back in read mode.
    await typeJson('{"id":"u1","email":null,"extra":1}');
    await click(buttonByText('Save', container)!);
    expect(jsonEditor()!.readOnly).toBe(true);
    expect(container.textContent).toContain(banner);
    await settleAutosave();
    expect(state.updates.at(-1)?.input.examples).toEqual([
      { name: 'minimal', value: { id: 'u1', email: null, extra: 1 } },
    ]);
  });

  it('[entity:dto-detail] the whole row is dragged to reorder; the handle in the row header is only visual', async () => {
    state.dto = sampleDto({
      examples: [
        { name: 'first', value: { id: '1' } },
        { name: 'second', value: { id: '2' } },
      ],
    });
    await render(createElement(routeTable().get('/dtos/$slug')!.component));

    const rows = exampleRows();
    expect(rows).toHaveLength(2);
    // The draggable element is the whole row: name, summary and the row actions.
    expect(rows[0]!.textContent).toContain('first');
    expect(rows[0]!.querySelector('button[title="Duplicate"]')).not.toBeNull();
    expect(rows[0]!.querySelector('button[title="Delete"]')).not.toBeNull();
    // Nothing inside the row (the grip included) is a drag source of its own.
    for (const row of rows) expect(row.querySelectorAll('[draggable]')).toHaveLength(0);

    await act(async () => {
      rows[1]!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    await act(async () => {
      rows[0]!.dispatchEvent(new Event('drop', { bubbles: true }));
    });
    expect(exampleRows().map((r) => r.querySelector('span.font-mono')?.textContent)).toEqual(['second', 'first']);
    await settleAutosave();
    expect((state.updates.at(-1)?.input.examples as Array<{ name: string }>).map((e) => e.name)).toEqual([
      'second',
      'first',
    ]);
  });
});

// ─── 2.1.19 — L11 manifest slot and L12 slice of the dto type ─────────────

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

const PKG_SRC = join(import.meta.dirname, '../../src');
const KIT_SRC = join(PKG_SRC, 'frontend-kit');

describe('[section:xvm9aann] dto manifest detailPanel slot — checked for shape, not rendered by the host', () => {
  it('[section:xvm9aann] the manifest declares detailPanel: DtoDetail next to routes, and the host slot check accepts it', () => {
    expect(dtoFrontendModule.detailPanel).toBe(DtoDetail);
    expect(typeof dtoFrontendModule.routes).toBe('function');
    expect(checkSlotShapes(dtoFrontendModule)).toBeNull();
    expect(checkSlotShapes({ ...dtoFrontendModule, detailPanel: {} as never })).toMatch(
      /'detailPanel' is declared but is not a React component/,
    );
  });

  it('[section:xvm9aann] the /dtos/$slug route renders DtoDetail itself', async () => {
    expect(readFileSync(join(FRONTEND_SRC, 'routes.tsx'), 'utf-8')).toMatch(/<DtoDetail\b/);
    await render(createElement(routeTable().get('/dtos/$slug')!.component));
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.some((i) => i.value === 'UserResponse')).toBe(true);
  });
});

describe('[section:9hz21ysc] dto Host UI Kit slice', () => {
  it('[section:9hz21ysc] the dto screens consume exactly the catalog components the slice lists — DocEditor among them; Pagination, DetailPanelShell, EntityDetailToolbar, SegmentedControlTabs, InlineEditField and Popover not', () => {
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

  it('[section:9hz21ysc] each host-local frontend-kit duplicate is recorded as DEBT naming its catalog replacement', () => {
    const debt: Array<[file: string, exports: string[], replacement: string | null]> = [
      ['EntityBreadcrumbBar.tsx', ['EntityBreadcrumbBar'], 'DetailPanelShell'],
      ['EntityViewSwitcher.tsx', ['EntityViewSwitcher'], 'SegmentedControlTabs'],
      ['SegmentedControl.tsx', ['SegmentedControl'], 'SegmentedControlTabs'],
      ['ButtonGroup.tsx', ['ButtonGroup', 'SegmentButton'], 'SegmentedControlTabs'],
      ['atoms.tsx', ['TagChip'], 'TagChip'],
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
    // Recorded, not fixed: the dto detail route still renders through the local bar.
    expect(readFileSync(join(FRONTEND_SRC, 'routes.tsx'), 'utf-8')).toMatch(/<EntityBreadcrumbBar\b/);
  });

  it('[section:9hz21ysc] ListPageHeader / ListScrollArea (struck from the slice in 2.1.20) are not carried by this package — the dto list composes their replacements directly', () => {
    const kit = readdirSync(KIT_SRC);
    expect(kit).not.toContain('ListPageHeader.tsx');
    expect(kit).not.toContain('ListScrollArea.tsx');
    const list = readFileSync(join(FRONTEND_SRC, 'list-page.tsx'), 'utf-8');
    for (const name of ['EntityListHeader', 'EntityListLayout', 'LoadingState', 'EmptyState']) {
      expect(list).toMatch(new RegExp(`<${name}\\b`));
    }
  });
});
