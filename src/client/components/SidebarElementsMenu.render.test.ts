// @vitest-environment happy-dom
/**
 * 2.1.50 (M13 `m13ui000`, `8a4oxdg4`, `e8xcx6g7`, `8mwihe60`, `5kkkih9i`;
 * M50 `8h2a734u`) — the ELEMENTS slot composed from the team's layout
 * (`elementsMenu`): file order, then the visible types the layout does not
 * place in the default `sidebarTab.order`; group entries with an icon from the
 * closed list, a summed counter and a side menu of their visible members;
 * hidden types without an entry; the normalization of a file that breaks the
 * save rules; and a layout saved elsewhere not reaching this page until reload.
 *
 * Rendered for real (`SidebarElements` + the shell's `SidebarSideMenu`); only
 * the router's `Link` is a plain anchor here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Database, FileText, Folder, Tag } from 'lucide-react';
import type { PluginActivationState } from '../../shared/plugin-host/types.js';
import type { ElementsMenuEntry } from '../../shared/elements-menu.js';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      title,
      style,
      role,
      onClick,
    }: {
      to: string;
      children?: ReactNode;
      title?: string;
      style?: Record<string, unknown>;
      role?: string;
      onClick?: (e: unknown) => void;
    }) => createElement('a', { href: to, title, style, role, onClick }, children),
  };
});

import { SidebarElements } from './Sidebar.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { groupIcon } from '../core/plugin-host/elements-menu.js';
import { useElementsMenuLayout } from '../hooks/useConfig.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from '../core/plugin-host/types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Noop = (() => null) as unknown as FrontendModule['renderChip'];

/** A hidden-shape module (no routes) — the smallest the host accepts; its tab is what matters. */
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

// Default order (sidebarTab.order): Delta(5) < Alpha(10) < Bravo(20) < Charlie(30).
clientPluginHost.registerFrontendModule(moduleOf('em-alpha', { label: 'Alpha', order: 10 }));
clientPluginHost.registerFrontendModule(moduleOf('em-bravo', { label: 'Bravo', order: 20 }));
clientPluginHost.registerFrontendModule(moduleOf('em-charlie', { label: 'Charlie', order: 30 }));
clientPluginHost.registerFrontendModule(moduleOf('em-delta', { label: 'Delta', order: 5 }));
// Active but tab-less, and registered but inactive (with a tab).
clientPluginHost.registerFrontendModule(moduleOf('em-tabless', null));
clientPluginHost.registerFrontendModule(moduleOf('em-off', { label: 'Off', order: 1 }));

const ACTIVE = ['em-alpha', 'em-bravo', 'em-charlie', 'em-delta', 'em-tabless'];
const activation = (active: string[]): PluginActivationState =>
  ({ active, inactive: ['em-off'], unknown: [] }) as PluginActivationState;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clientPluginHost.applyActivation(activation(ACTIVE));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ALL_COUNTS = { 'em-alpha': 1, 'em-bravo': 2, 'em-charlie': 4, 'em-delta': 8 };

async function render(
  elementsMenu: ElementsMenuEntry[] | undefined,
  { pathname = '/', entityCounts = ALL_COUNTS as Record<string, number> } = {},
) {
  await act(async () => {
    root.render(createElement(SidebarElements, { entityCounts, pathname, elementsMenu }));
  });
}

const list = () => host.querySelector('[data-elements-list]')!;
/** The top-level ELEMENTS entries — links (type) and side-menu triggers (group) — by title. */
const topLevel = () =>
  Array.from(list().children)
    .filter((el) => el.tagName === 'A' || el.tagName === 'BUTTON')
    .map((el) => el.getAttribute('title'));
const groupTrigger = (label: string) =>
  Array.from(list().querySelectorAll('button[aria-haspopup="menu"]')).find(
    (b) => b.getAttribute('title') === label,
  ) as HTMLButtonElement | undefined;
const entry = (title: string) =>
  Array.from(list().children).find((el) => el.getAttribute('title') === title) as HTMLElement | undefined;
const isActive = (el: HTMLElement | undefined) => el?.style.fontWeight === '600';
const groupCount = (label: string) => groupTrigger(label)!.querySelector('span.font-mono')!;

async function openGroup(label: string) {
  await act(async () => {
    groupTrigger(label)!.click();
  });
}
const menuItems = () =>
  Array.from(host.querySelectorAll('[role="menu"] [role="menuitem"]')).map(
    (a) => a.querySelector('span')?.textContent,
  );

describe('ELEMENTS order (M13 e8xcx6g7)', () => {
  it('[ac:ac-brak-klucza-elementsmenu-daje-wpisy-e] with no elementsMenu key the ELEMENTS entries stand in sidebarTab.order', async () => {
    await render(undefined);
    expect(topLevel()).toEqual(['Delta', 'Alpha', 'Bravo', 'Charlie']);
  });

  it('[ac:ac-wpisy-elements-stoja-w-kolejnosci-z-e] the ELEMENTS entries stand in the order of elementsMenu', async () => {
    await render([{ type: 'em-charlie' }, { type: 'em-alpha' }, { type: 'em-delta' }, { type: 'em-bravo' }]);
    expect(topLevel()).toEqual(['Charlie', 'Alpha', 'Delta', 'Bravo']);
  });

  it('[ac:ac-widoczny-typ-nieobecny-w-elementsmenu] a visible type absent from elementsMenu stands after the entries from the file', async () => {
    // Alpha has the lowest default order of the two, yet stands after the file's entry.
    await render([{ type: 'em-charlie' }, { type: 'em-delta' }, { type: 'em-bravo' }]);
    expect(topLevel()).toEqual(['Charlie', 'Delta', 'Bravo', 'Alpha']);
  });

  it('[ac:ac-typy-nieobecne-w-elementsmenu-stoja-w] the types absent from elementsMenu stand in sidebarTab.order', async () => {
    await render([{ type: 'em-charlie' }]);
    // Delta(5), Alpha(10), Bravo(20) — the default order, after the file's Charlie.
    expect(topLevel()).toEqual(['Charlie', 'Delta', 'Alpha', 'Bravo']);
  });

  it('[ac:ac-wpis-typu-w-elements-moze-stac-przed] a type entry in ELEMENTS can stand before a group entry', async () => {
    await render([{ type: 'em-charlie' }, { group: 'Contracts', types: ['em-alpha', 'em-bravo'] }, { type: 'em-delta' }]);
    expect(topLevel()).toEqual(['Charlie', 'Contracts', 'Delta']);
    expect(entry('Charlie')!.tagName).toBe('A');
    expect(entry('Contracts')!.tagName).toBe('BUTTON');
  });
});

describe('ELEMENTS groups (M13 m13ui000, 8a4oxdg4, 8mwihe60)', () => {
  it('[ac:ac-grupa-typow-zajmuje-w-elements-jeden] a group of types takes one entry in ELEMENTS', async () => {
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-bravo', 'em-charlie'] }]);
    expect(topLevel()).toEqual(['Contracts', 'Delta']);
    expect(list().querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(1);
  });

  it('[ac:ac-typ-zgrupowany-nie-ma-wlasnego-wpisu] a grouped type has no entry of its own at the top level of ELEMENTS', async () => {
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-bravo'] }]);
    // Neither member stands at the top level — not in place, not appended at the end.
    expect(topLevel()).toEqual(['Contracts', 'Delta', 'Charlie']);
    expect(topLevel()).not.toContain('Alpha');
    expect(topLevel()).not.toContain('Bravo');
  });

  it('[ac:ac-grupa-bez-widocznego-czlonka-nie-ma-w] a group without a visible member has no entry in ELEMENTS', async () => {
    // Inactive, unknown and tab-less members only.
    await render([{ group: 'Ghosts', types: ['em-off', 'em-nowhere', 'em-tabless'] }, { type: 'em-alpha' }]);
    expect(groupTrigger('Ghosts')).toBeUndefined();
    expect(topLevel()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
  });

  it('[ac:ac-grupa-z-jednym-widocznym-czlonkiem-ma] a group with one visible member has a group entry in ELEMENTS', async () => {
    await render([{ group: 'Solo', types: ['em-off', 'em-alpha'] }]);
    // Still a group (a side-menu trigger), not flattened into Alpha's link.
    expect(groupTrigger('Solo')).toBeDefined();
    expect(topLevel()).toEqual(['Solo', 'Delta', 'Bravo', 'Charlie']);
    expect(topLevel()).not.toContain('Alpha');
  });

  it('[ac:ac-ikona-grupy-spoza-listy-ikon-grup-daj] a group icon outside the list of group icons gives the default icon', async () => {
    expect(groupIcon('not-a-group-icon')).toBe(Folder);
    expect(groupIcon(undefined)).toBe(Folder);
    expect(groupIcon('database')).toBe(Database);
    // Not inherited from Object.prototype either.
    expect(groupIcon('toString')).toBe(Folder);
    await render([
      { group: 'Odd', icon: 'not-a-group-icon', types: ['em-alpha'] },
      { group: 'Listed', icon: 'database', types: ['em-bravo'] },
    ]);
    expect(groupTrigger('Odd')!.querySelector('svg')!.getAttribute('class')).toContain('lucide-folder');
    expect(groupTrigger('Listed')!.querySelector('svg')!.getAttribute('class')).toContain('lucide-database');
  });

  it('[ac:ac-klik-wpisu-grupy-w-elements-otwiera-m] a click on a group entry in ELEMENTS opens the side menu', async () => {
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-bravo'] }]);
    const trigger = groupTrigger('Contracts')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await openGroup('Contracts');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = host.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Contracts');
    expect(menuItems()).toEqual(['Alpha', 'Bravo']);
    // The items are links to the members' routes.
    expect(Array.from(menu.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      '/em-alphas',
      '/em-bravos',
    ]);
  });

  it('[ac:ac-pozycje-menu-bocznego-grupy-stoja-w-k] the items of a group side menu stand in the order of types', async () => {
    // Against the default order (Alpha 10 < Bravo 20 < Charlie 30).
    await render([{ group: 'Contracts', types: ['em-charlie', 'em-alpha', 'em-bravo'] }]);
    await openGroup('Contracts');
    expect(menuItems()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('[ac:ac-typ-nieaktywny-w-grupie-nie-ma-pozycj] an inactive type in a group has no item in the group menu', async () => {
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-off', 'em-bravo'] }]);
    await openGroup('Contracts');
    expect(menuItems()).toEqual(['Alpha', 'Bravo']);
    expect(menuItems()).not.toContain('Off');
  });

  it('[ac:ac-licznik-wpisu-grupy-rowna-sie-sumie-l] the counter of a group entry equals the sum of its visible members counters', async () => {
    // The inactive member's counter (100) is not part of the sum.
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-off', 'em-charlie'] }], {
      entityCounts: { ...ALL_COUNTS, 'em-off': 100 },
    });
    expect(groupCount('Contracts').textContent).toBe('5');
    expect(groupCount('Contracts').hasAttribute('data-count-pending')).toBe(false);
  });

  it('[ac:ac-licznik-wpisu-grupy-pokazuje-placehol] the counter of a group entry shows a placeholder until the counters of all members arrive', async () => {
    // Nothing arrived yet.
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-bravo'] }], { entityCounts: {} });
    expect(groupCount('Contracts').textContent).toBe('…');
    expect(groupCount('Contracts').hasAttribute('data-count-pending')).toBe(true);
    // One of two arrived: still the placeholder, not a partial sum.
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-bravo'] }], { entityCounts: { 'em-alpha': 1 } });
    expect(groupCount('Contracts').textContent).toBe('…');
    // All arrived (a zero counts as arrived): the sum.
    await render([{ group: 'Contracts', types: ['em-alpha', 'em-bravo'] }], {
      entityCounts: { 'em-alpha': 1, 'em-bravo': 0 },
    });
    expect(groupCount('Contracts').textContent).toBe('1');
    expect(groupCount('Contracts').hasAttribute('data-count-pending')).toBe(false);
  });
});

describe('ELEMENTS entries and their activity (M50 8h2a734u)', () => {
  it('[ac:ac-wpis-sidebara-obejmujacy-kilka-typow] a sidebar entry covering several types is active on the route of each of those types', async () => {
    const layout: ElementsMenuEntry[] = [{ group: 'Contracts', types: ['em-alpha', 'em-bravo'] }];
    await render(layout, { pathname: '/em-alphas' });
    expect(isActive(groupTrigger('Contracts'))).toBe(true);
    await render(layout, { pathname: '/em-bravos/b-1' });
    expect(isActive(groupTrigger('Contracts'))).toBe(true);
    // Not on another type's route — that type's own entry is the active one.
    await render(layout, { pathname: '/em-charlies' });
    expect(isActive(groupTrigger('Contracts'))).toBe(false);
    expect(isActive(entry('Charlie'))).toBe(true);
  });
});

describe('hidden and inactive types (M13 8mwihe60)', () => {
  it('[ac:ac-typ-ukryty-w-elementsmenu-nie-ma-wpis] a type hidden in elementsMenu has no entry in ELEMENTS', async () => {
    await render([{ type: 'em-alpha', hidden: true }, { type: 'em-bravo' }]);
    // No entry in place and none appended at the end with the unplaced types.
    expect(topLevel()).toEqual(['Bravo', 'Delta', 'Charlie']);
    // Hiding is not deactivation: the type is still active in the host.
    expect(clientPluginHost.isActive('em-alpha')).toBe(true);
    expect(clientPluginHost.getEntity('em-alpha')).not.toBeNull();
  });

  it('[ac:ac-na-trasie-ukrytego-typu-zaden-wpis-el] on the route of a hidden type no ELEMENTS entry is active', async () => {
    await render([{ type: 'em-alpha', hidden: true }, { group: 'Rest', types: ['em-bravo', 'em-charlie'] }], {
      pathname: '/em-alphas/a-1',
    });
    const entries = Array.from(list().children).filter((el) => el.tagName === 'A' || el.tagName === 'BUTTON');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((el) => isActive(el as HTMLElement))).toEqual([]);
  });

  it('[ac:ac-wpis-typu-nieaktywnego-w-elementsmenu] a type entry of an inactive type in elementsMenu gives no entry in ELEMENTS', async () => {
    await render([{ type: 'em-off' }, { type: 'em-nowhere' }, { type: 'em-alpha' }]);
    expect(topLevel()).not.toContain('Off');
    expect(topLevel()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
  });
});

describe('a file breaking the save rules loads normalized (M13 5kkkih9i)', () => {
  it('[ac:ac-typ-zapisany-w-elementsmenu-dwa-razy] a type written in elementsMenu twice appears in ELEMENTS only at its first occurrence', async () => {
    await render([{ type: 'em-bravo' }, { type: 'em-alpha' }, { type: 'em-bravo' }]);
    expect(topLevel()).toEqual(['Bravo', 'Alpha', 'Delta', 'Charlie']);
    // First as a type entry, then as a group member: the group keeps the rest.
    await render([{ type: 'em-bravo' }, { group: 'Contracts', types: ['em-bravo', 'em-alpha'] }]);
    expect(topLevel()).toEqual(['Bravo', 'Contracts', 'Delta', 'Charlie']);
    await openGroup('Contracts');
    expect(menuItems()).toEqual(['Alpha']);
  });

  it('[section:5kkkih9i] a group with a blank label or empty types is treated as absent — its members stand at the end in sidebarTab.order — and duplicated group labels both render', async () => {
    await render([
      { group: '   ', types: ['em-charlie', 'em-alpha'] },
      { group: 'Empty', types: [] },
      { type: 'em-bravo' },
    ]);
    // No entry for either group; Charlie and Alpha are unplaced, so they follow
    // Bravo in the default order with Delta.
    expect(topLevel()).toEqual(['Bravo', 'Delta', 'Alpha', 'Charlie']);
    expect(list().querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(0);

    await render([
      { group: 'Twins', types: ['em-alpha'] },
      { group: 'twins', types: ['em-bravo'] },
      { group: 'Twins', types: ['em-charlie'] },
    ]);
    expect(topLevel()).toEqual(['Twins', 'twins', 'Twins', 'Delta']);
  });
});

describe('the layout is read once per page load (M50 8h2a734u)', () => {
  /** The sidebar as the shell wires it: the layout from `useElementsMenuLayout`. */
  function Probe() {
    const layout = useElementsMenuLayout();
    return createElement(SidebarElements, {
      entityCounts: ALL_COUNTS,
      pathname: '/',
      elementsMenu: layout.layout,
      layoutPending: !layout.ready,
    });
  }

  it('[ac:ac-zmiana-elementsmenu-zapisana-w-innej] a change of elementsMenu saved in another browser tab does not change the sidebar without a page reload', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['config'], { elementsMenu: [{ type: 'em-charlie' }, { type: 'em-bravo' }] });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
    });
    expect(topLevel()).toEqual(['Charlie', 'Bravo', 'Delta', 'Alpha']);

    // Another tab saved a new layout; this tab's config cache is refetched (a
    // WS-driven invalidation lands the server's new answer in the cache).
    await act(async () => {
      qc.setQueryData(['config'], {
        elementsMenu: [{ group: 'Everything', types: ['em-alpha', 'em-bravo', 'em-charlie', 'em-delta'] }],
      });
    });
    expect((qc.getQueryData(['config']) as { elementsMenu: unknown[] }).elementsMenu).toHaveLength(1);
    // The sidebar keeps the layout it was loaded with.
    expect(topLevel()).toEqual(['Charlie', 'Bravo', 'Delta', 'Alpha']);
    expect(groupTrigger('Everything')).toBeUndefined();

    // A page reload starts a new query cache — only then does the new layout show.
    act(() => root.unmount());
    root = createRoot(host);
    const reloaded = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    reloaded.setQueryData(['config'], qc.getQueryData(['config']));
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: reloaded }, createElement(Probe)));
    });
    expect(topLevel()).toEqual(['Everything']);
  });
});
