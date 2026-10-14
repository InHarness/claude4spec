// @vitest-environment happy-dom
/**
 * 2.1.20 (M13 `mbladez6`, `chipprops`, `z5jthgfh`) — the `mountFrontend` step,
 * driven end to end with the REAL slot smoke test (a DOM is needed for it, which
 * is why this is not part of the node-env `mountFrontend.test.ts`).
 *
 * The module enters the registry the way a plugin's entry hands it over —
 * `registerFrontendModule` — which registers and mounts nothing; the host then
 * mounts it. What the step must guarantee:
 *
 *  - a `renderChip` that fails the smoke test degrades to the host's
 *    `rejected-slot` broken chip, and the MODULE stays mounted: its routes, its
 *    sidebar tab and its editor extensions keep working;
 *  - the detail page of a type with a route is rendered by the component of its
 *    `routes` fragment — the host never renders `detailPanel`.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tag } from 'lucide-react';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // The sidebar tabs are plain links; a router instance is beside the point.
    Link: ({ to, children, title }: { to: string; children?: ReactNode; title?: string }) =>
      createElement('a', { href: to, title, 'data-tab': title }, children),
  };
});

import { createRoute } from '@tanstack/react-router';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { clientPluginHost, registerFrontendModule } from '../core/plugin-host/host.js';
import { rootRoute } from '../router.js';
import { mountFrontend } from './mountFrontend.js';
import { getEditorExtensionRegistration } from './registry.js';
import { ChipResolver } from '../entities/ChipResolver.js';
import { SidebarElements } from '../components/Sidebar.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Noop = (() => null) as unknown as FrontendModule['renderCard'];

const fakeRouter = () =>
  ({
    setRoutes: () => {},
    buildRouteTree: () => [],
    invalidate: () => {},
  }) as never;

type RouteLike = { options?: { path?: string; component?: unknown } };

/** The route currently attached under the host root at `path`, after a mount. */
const mountedRoute = (path: string): RouteLike | undefined =>
  ((rootRoute as unknown as { children?: RouteLike[] }).children ?? []).find((r) => r.options?.path === path);

/** A plugin route fragment: list + detail, the detail being the plugin's own page. */
function fragmentFor(prefix: string, detail: unknown): FrontendModule['routes'] {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: unknown;
  }) => unknown;
  return ({ rootRoute: parent }) =>
    [
      make({ getParentRoute: () => parent, path: prefix, component: Noop }),
      make({ getParentRoute: () => parent, path: `${prefix}/$slug`, component: detail }),
    ] as never;
}

function browsableModule(type: string, overrides: Partial<FrontendModule>): FrontendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 500,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    detailPanel: Noop,
    routes: fragmentFor(`/${type}s`, Noop),
    useGetBySlug: () => ({ data: { title: 'present' }, isLoading: false }),
    listByTags: async () => [],
    ...overrides,
  } as unknown as FrontendModule;
}

let warn: MockInstance;
let error: MockInstance;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // The smoke test reports the throw it caught; React logs it too.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  warn.mockRestore();
  error.mockRestore();
});

/**
 * A chip that throws exactly on `entity: null` — the input the smoke test hands
 * it — and renders its own markup for a real entity. If the host kept it, a
 * resolved entity would show `TYPE-CHIP`.
 */
const chipThrowingOnNull = (({ entity }: { entity: unknown }) => {
  if (entity === null) throw new Error('cannot render a null entity');
  return createElement('span', { 'data-type-chip': '' }, 'TYPE-CHIP');
}) as unknown as FrontendModule['renderChip'];

describe('mountFrontend — a renderChip rejected by the smoke test', () => {
  it('[ac:ac-renderchip-ktory-rzuca-przy-entity-nu] a renderChip that throws at entity: null in the slot smoke test yields a broken chip of category rejected-slot instead of the type chip', async () => {
    const mod = browsableModule('brittle-chip', { renderChip: chipThrowingOnNull });
    registerFrontendModule(mod);
    mountFrontend(fakeRouter(), [clientPluginHost.getEntity('brittle-chip')!]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot render a null entity'));

    // The host resolver renders the chip the way every pipeline does — with a
    // RESOLVED entity this time, so the type chip would render if it were kept.
    await act(async () => {
      root.render(createElement(ChipResolver, { type: 'brittle-chip', slug: 'one' }));
    });
    const broken = host.querySelector('[data-broken-category]');
    expect(broken).not.toBeNull();
    expect(broken!.getAttribute('data-broken-category')).toBe('rejected-slot');
    expect(broken!.textContent).toBe('[broken: one]');
    expect(host.querySelector('[data-type-chip]')).toBeNull();
    expect(host.textContent).not.toContain('TYPE-CHIP');
  });

  it('[ac:ac-modul-frontendu-ktorego-renderchip-ni] a module whose renderChip failed the slot smoke test stays mounted — its routes, sidebar tab and editor extensions keep working', async () => {
    const extension = { name: 'brittle-mounted-ext', priority: 1000 };
    const mod = browsableModule('brittle-mounted', {
      renderChip: chipThrowingOnNull,
      sidebarTab: { icon: Tag, label: 'Brittles', order: 50 },
      editorExtensions: [extension],
    });
    const originalCard = mod.renderCard;

    // Registration does not run the smoke test and so cannot be what drops it.
    expect(() => registerFrontendModule(mod)).not.toThrow();
    mountFrontend(fakeRouter(), [clientPluginHost.getEntity('brittle-mounted')!]);

    // The chip slot WAS rejected…
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rejected by the smoke test'));
    expect((mod.renderChip as { displayName?: string }).displayName).toBe(
      'RejectedSlotFallback(brittle-mounted.renderChip)',
    );

    // …and the module is still mounted, whole:
    // still registered and active, with every other slot it shipped;
    expect(clientPluginHost.getEntity('brittle-mounted')).toBe(mod);
    expect(mod.renderCard).toBe(originalCard);
    // its routes are in the host route tree;
    expect(mountedRoute('/brittle-mounteds')).toBeDefined();
    expect(mountedRoute('/brittle-mounteds/$slug')).toBeDefined();
    // its editor extension is pinned onto the shared editor registry;
    expect(getEditorExtensionRegistration('brittle-mounted-ext')).toBe(extension);
    // its sidebar tab renders in ELEMENTS, linking to its route.
    await act(async () => {
      root.render(createElement(SidebarElements, { entityCounts: { 'brittle-mounted': 2 }, pathname: '/' }));
    });
    const tab = host.querySelector('a[data-tab="Brittles"]');
    expect(tab).not.toBeNull();
    expect(tab!.getAttribute('href')).toBe('/brittle-mounteds');
  });
});

describe('mountFrontend — the detail page of a type with a route', () => {
  it('[ac:ac-strone-detalu-typu-z-trasa-renderuje] the detail page of a type with a route is rendered by the component from the plugin routes, not by the detailPanel slot', () => {
    const RouteDetail = vi.fn(() => createElement('section', { 'data-route-detail': '' }, 'ROUTE-DETAIL'));
    const DetailPanel = vi.fn(() => createElement('section', { 'data-detail-panel': '' }, 'DETAIL-PANEL'));
    const mod = browsableModule('routed', {
      routes: fragmentFor('/routeds', RouteDetail),
      detailPanel: DetailPanel as unknown as FrontendModule['detailPanel'],
    });
    registerFrontendModule(mod);
    mountFrontend(fakeRouter(), [clientPluginHost.getEntity('routed')!]);

    // The detail route the host mounted is the PLUGIN's — its component is the
    // one the fragment declared, not the declared panel and not a host page.
    const detailRoute = mountedRoute('/routeds/$slug');
    expect(detailRoute).toBeDefined();
    expect(detailRoute!.options!.component).toBe(RouteDetail);
    expect(detailRoute!.options!.component).not.toBe(DetailPanel);

    // Rendering what that route renders shows the plugin's page…
    const html = renderToStaticMarkup(createElement(detailRoute!.options!.component as never));
    expect(html).toContain('ROUTE-DETAIL');
    expect(html).not.toContain('DETAIL-PANEL');
    expect(RouteDetail).toHaveBeenCalled();

    // …and the host rendered the declared `detailPanel` nowhere: not while
    // registering, not while mounting, not as the route's page.
    expect(DetailPanel).not.toHaveBeenCalled();
  });
});
