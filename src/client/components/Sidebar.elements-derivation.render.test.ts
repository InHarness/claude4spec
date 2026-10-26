// @vitest-environment happy-dom
/**
 * 2.1.50 (M13 `m13ui000`, `e8xcx6g7`; M50 `8h2a734u`) — where the ELEMENTS
 * entries come from, rendered in the whole sidebar:
 *
 *  - the entries derive from the active modules (`ctx.pluginHost.listEntities()`)
 *    — `sidebarTab.order` holds with no `elementsMenu` key and for the types the
 *    key does not place;
 *  - a module with no `sidebarTab` has no entry, yet stays active for references
 *    (its chips are not broken);
 *  - the Pages tree (M02) and the OTHERS side menu (Tags from M18) are not built
 *    from that mechanism: neither the layout nor the set of active modules moves
 *    them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileText, Tag } from 'lucide-react';
import type { PageNode, Root as PageRoot, SidebarAccordion } from '../../shared/types.js';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';
import type { ElementsMenuEntry } from '../../shared/elements-menu.js';

const h = vi.hoisted(() => ({
  layout: undefined as ElementsMenuEntry[] | undefined,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      title,
      style,
      role,
      onClick,
    }: {
      to: string;
      params?: { _splat?: string };
      children?: ReactNode;
      title?: string;
      style?: Record<string, unknown>;
      role?: string;
      onClick?: (e: unknown) => void;
    }) => createElement('a', { href: params?._splat ?? to, title, style, role, onClick }, children),
    useNavigate: () => () => {},
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: '/' } }),
  };
});

const ROOTS: PageRoot[] = [{ id: 'spec', name: 'Spec', dir: 'pages', builtin: true }];
const ACCORDIONS: SidebarAccordion[] = [{ rootId: 'spec', key: 'root', label: 'Spec', path: '' }];
const TREE: PageNode[] = [
  { type: 'file', name: 'index.md', path: 'index.md', fileType: 'markdown' },
  { type: 'file', name: 'tags.md', path: 'tags.md', fileType: 'markdown' },
] as PageNode[];

vi.mock('../hooks/useConfig.js', () => ({
  useRoots: () => ROOTS,
  useBaseRootId: () => 'spec',
  useElementsMenuLayout: () => ({ ready: true, layout: h.layout }),
}));

vi.mock('../hooks/usePages.js', () => ({
  usePages: (rootId: string | null) => ({ data: rootId === 'spec' ? TREE : [] }),
  useSidebarAccordions: () => ({ data: ACCORDIONS, isSuccess: true }),
  usePagesSearch: () => ({ data: [], isFetching: false }),
}));

vi.mock('./UserSection.js', () => ({ UserSection: () => null }));
vi.mock('./GitStatusBadge.js', () => ({ GitStatusBadge: () => null }));
vi.mock('./ProjectSwitcher.js', () => ({ ProjectSwitcher: () => null }));

import { Sidebar } from './Sidebar.js';
import { categoriseBrokenChip, clientPluginHost } from '../core/plugin-host/host.js';
import { composeElementsSlot } from '../core/plugin-host/elements-menu.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from '../core/plugin-host/types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Noop = (() => null) as unknown as FrontendModule['renderChip'];

const moduleOf = (type: string, tab: { label: string; order: number } | null): FrontendModule =>
  ({
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: type,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    renderOverlay: Noop,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
    ...(tab ? { sidebarTab: { icon: tab.order % 2 ? FileText : Tag, label: tab.label, order: tab.order } } : {}),
  }) as unknown as FrontendModule;

// Default order (sidebarTab.order): Charlie(5) < Alpha(10) < Bravo(20).
clientPluginHost.registerFrontendModule(moduleOf('ed-alpha', { label: 'Alpha', order: 10 }));
clientPluginHost.registerFrontendModule(moduleOf('ed-bravo', { label: 'Bravo', order: 20 }));
clientPluginHost.registerFrontendModule(moduleOf('ed-charlie', { label: 'Charlie', order: 5 }));
// Active but tab-less; registered but inactive (with a tab).
clientPluginHost.registerFrontendModule(moduleOf('ed-tabless', null));
clientPluginHost.registerFrontendModule(moduleOf('ed-off', { label: 'Off', order: 1 }));

const ACTIVE = ['ed-alpha', 'ed-bravo', 'ed-charlie', 'ed-tabless'];
const activation = (active: string[]): PluginActivationState =>
  ({ active, inactive: ['ed-off'], unknown: [] }) as PluginActivationState;

const OTHERS = ['Plans', 'Releases', 'TODOs', 'Tags', 'Links', 'Briefs'];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.layout = undefined;
  clientPluginHost.applyActivation(activation(ACTIVE));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clientPluginHost.applyActivation(activation(ACTIVE));
});

async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Sidebar, {
          width: 300,
          cwdPath: '/tmp/x',
          projectName: 'x',
          headerLoading: false,
          entityCounts: { 'ed-alpha': 1, 'ed-bravo': 2, 'ed-charlie': 3, 'ed-tabless': 4 },
          todoCount: 0,
          todoCountByPath: {},
          brokenLinkCount: 0,
          unresolvedMentionCount: 0,
        }),
      ),
    );
  });
}

const list = () => host.querySelector('[data-elements-list]')!;
/** The top-level ELEMENTS entries — links (type) and side-menu triggers (group) — by title. */
const elements = () =>
  Array.from(list().children)
    .filter((el) => el.tagName === 'A' || el.tagName === 'BUTTON')
    .map((el) => el.getAttribute('title'));
const treeRows = () =>
  Array.from(host.querySelectorAll('[data-page-row]')).map((el) => el.getAttribute('data-page-row'));
const othersTrigger = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')).find((b) =>
    b.getAttribute('title')?.startsWith('Others'),
  );

/** Opens OTHERS, reads its items, closes it again. */
async function othersItems(): Promise<Array<string | null | undefined>> {
  await act(async () => {
    othersTrigger()!.click();
  });
  const menu = document.body.querySelector('[role="menu"][aria-label="Others"]')!;
  const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
    (a) => a.querySelector('span')?.textContent,
  );
  await act(async () => {
    othersTrigger()!.click();
  });
  return items;
}

describe('ELEMENTS entries derive from the active modules (M13 m13ui000, e8xcx6g7)', () => {
  it('[ac:ac-wpisy-w-sekcji-elements-sidebara-derywow] the ELEMENTS entries derive from listEntities() in sidebarTab.order (no elementsMenu and for the types absent from it); a module with no sidebarTab has no entry but stays active for references; the Pages tree and the OTHERS menu do not use this mechanism', async () => {
    // (1) No key: the default order over the ACTIVE modules with a tab — the
    // inactive `ed-off` (order 1) and the tab-less `ed-tabless` have no entry.
    await render();
    expect(elements()).toEqual(['Charlie', 'Alpha', 'Bravo']);
    expect(composeElementsSlot(clientPluginHost.listEntities(), undefined).map((e) =>
      e.kind === 'type' ? e.module.type : e.label,
    )).toEqual(['ed-charlie', 'ed-alpha', 'ed-bravo']);

    // (2) With the key: the file's entry first, the absent types after it in
    // sidebarTab.order; the tab-less type stays without an entry even when named.
    h.layout = [{ type: 'ed-tabless' }, { type: 'ed-bravo' }];
    await render();
    expect(elements()).toEqual(['Bravo', 'Charlie', 'Alpha']);

    // (3) The tab-less module is still active for references: the host returns
    // it, lists it, and its chips are not categorised as broken.
    expect(clientPluginHost.isActive('ed-tabless')).toBe(true);
    expect(clientPluginHost.getEntity('ed-tabless')).not.toBeNull();
    expect(clientPluginHost.listEntities().map((m) => m.type)).toContain('ed-tabless');
    expect(categoriseBrokenChip('ed-tabless')).toBeNull();
    // …unlike the inactive one.
    expect(categoriseBrokenChip('ed-off')).toBe('inactive-plugin');

    // (4) The Pages tree and OTHERS do not come from this mechanism. Baseline:
    h.layout = undefined;
    await render();
    const baseTree = treeRows();
    expect(baseTree).toEqual(['index.md', 'tags.md']);
    expect(await othersItems()).toEqual(OTHERS);
    // Neither is inside the ELEMENTS list.
    expect(list().querySelector('[data-page-row]')).toBeNull();
    expect(list().contains(othersTrigger()!)).toBe(false);

    // A layout hiding every visible type and naming `pages`/`tags` empties
    // ELEMENTS, yet the tree and OTHERS (with Tags) stay as they were.
    h.layout = [
      { type: 'ed-alpha', hidden: true },
      { type: 'ed-bravo', hidden: true },
      { type: 'ed-charlie', hidden: true },
      { type: 'tags' },
      { group: 'Pages', types: ['pages', 'tag'] },
    ];
    await render();
    expect(elements()).toEqual([]);
    expect(treeRows()).toEqual(baseTree);
    expect(await othersItems()).toEqual(OTHERS);

    // No active module at all: ELEMENTS has nothing to derive, the tree and
    // OTHERS are untouched.
    h.layout = undefined;
    clientPluginHost.applyActivation(activation([]));
    await render();
    expect(elements()).toEqual([]);
    expect(list().textContent).toContain('No entity types configured.');
    expect(treeRows()).toEqual(baseTree);
    expect(await othersItems()).toEqual(OTHERS);
  });
});
