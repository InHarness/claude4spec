/**
 * 0.2.16 — the first coverage of route COLLECTION, added because this release
 * put the host's own entity routes through it.
 *
 * `/acs`, `/ui-views` and `/design-systems` used to be static entries in
 * `BASE_ROUTE_CHILDREN`; they are now `RouteTreeFragment`s on their modules,
 * mounted through the same door as the external plugins'. That makes two silent
 * failure modes newly reachable for built-in pages: a fragment whose paths
 * collide with the base tree (deduped away, so the page would 404), and a
 * fragment that throws (skipped with a warning, same result). Neither shows up
 * in a type check.
 */

import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { BASE_ROUTE_CHILDREN, rootRoute } from '../router.js';
import { acRoutes } from '../entities/ac/routes.js';
import { createRoute } from '@tanstack/react-router';
import { mountFrontend } from './mountFrontend.js';

const Noop = (() => null) as unknown as FrontendModule['renderCard'];

/**
 * A route fragment the host does not own.
 *
 * `ui-view` and `design-system` played this part until 0.2.18 moved them into
 * the `c4s-plugin-frontend-mockups` envelope, leaving `ac` as the only in-host
 * fragment. Synthesising the other two is closer to the real thing anyway: what
 * `mountFrontend` has to get right is a fragment arriving from a package the
 * host cannot import, which is now every fragment but one.
 */
function fragmentFor(prefix: string): FrontendModule['routes'] {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: unknown;
  }) => unknown;
  return ({ rootRoute: parent }) =>
    [
      make({ getParentRoute: () => parent, path: prefix, component: Noop }),
      make({ getParentRoute: () => parent, path: `${prefix}/$slug`, component: Noop }),
    ] as never;
}

const uiViewRoutes = fragmentFor('/ui-views');
const designSystemRoutes = fragmentFor('/design-systems');

function moduleWith(type: string, routes: FrontendModule['routes']): FrontendModule {
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
    routes,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;
}

/**
 * A router stand-in. `rebuildRouteTree` attaches the combined tree to the real
 * host `rootRoute` and then only asks the router to re-derive matching from it,
 * so what actually got mounted is read off `rootRoute.children` — the router
 * itself needs no behaviour here beyond not throwing.
 */
const fakeRouter = () =>
  ({
    setRoutes: () => {},
    buildRouteTree: () => [],
    invalidate: () => {},
  }) as never;

const pathOf = (route: unknown): string | undefined =>
  (route as { options?: { path?: string } }).options?.path;

/** The paths currently attached under the host root, after a mount. */
const mountedPaths = (): Array<string | undefined> =>
  ((rootRoute as unknown as { children?: unknown[] }).children ?? []).map(pathOf);

describe('mountFrontend collects the hoisted entity routes', () => {
  it('mounts every path of three fragments, none deduped against the base tree', () => {
    mountFrontend(fakeRouter(), [
      moduleWith('ac', acRoutes),
      moduleWith('ui-view', uiViewRoutes),
      moduleWith('design-system', designSystemRoutes),
    ]);

    expect(mountedPaths()).toEqual(
      expect.arrayContaining([
        '/acs',
        '/acs/$slug',
        '/acs/$slug/history',
        '/ui-views',
        '/ui-views/$slug',
        '/design-systems',
        '/design-systems/$slug',
      ]),
    );
  });

  /**
   * The regression this file exists for. The host seeds its dedup set from
   * `BASE_ROUTE_CHILDREN` and lets the base tree win — so leaving a hoisted
   * route behind in that list would silently suppress the fragment's copy of it,
   * and the page would keep working right up until someone edited the fragment.
   */
  it('leaves no hoisted path behind in BASE_ROUTE_CHILDREN', () => {
    const basePaths = BASE_ROUTE_CHILDREN.map(pathOf);
    for (const hoisted of ['/acs', '/acs/$slug', '/ui-views', '/design-systems/$slug']) {
      expect(basePaths).not.toContain(hoisted);
    }
  });

  /**
   * The consequence the hoist bought, stated as a test so nobody has to rediscover
   * it: these three pages now EXIST only while their type is active. Both callers
   * pass `clientPluginHost.listEntities()`, which is activation-filtered, so a
   * deactivated `ac` has no `/acs` route at all — where before the hoist the route
   * was unconditional and only the sidebar tab came and went.
   *
   * That is why `EntitiesSection` re-runs `mountFrontend` after `applyActivation`:
   * without it a re-enabled type gets its tab back (the sidebar re-renders) while
   * this tree still reflects the activation of the last mount, and the tab lands
   * on the not-found screen until a reload.
   */
  it('drops a deactivated type\'s routes, and restores them on the next mount', () => {
    // What the settings save produces when `ac` is switched off: the filtered
    // module list simply does not contain it.
    mountFrontend(fakeRouter(), [moduleWith('ui-view', uiViewRoutes)]);
    expect(mountedPaths()).not.toContain('/acs');

    // ...and back on. Idempotent rebuild from the frozen base, so re-mounting is
    // the whole repair — no accumulated duplicate of `/ui-views`.
    mountFrontend(fakeRouter(), [moduleWith('ac', acRoutes), moduleWith('ui-view', uiViewRoutes)]);
    expect(mountedPaths()).toContain('/acs');
    expect(mountedPaths().filter((p) => p === '/ui-views')).toHaveLength(1);
  });

  it('a fragment that throws is skipped with a warning, not a crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const exploding = (() => {
      throw new Error('boom');
    }) as unknown as FrontendModule['routes'];

    mountFrontend(fakeRouter(), [moduleWith('exploder', exploding), moduleWith('ac', acRoutes)]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    // The healthy module still mounted — one bad fragment does not take the rest.
    expect(mountedPaths()).toContain('/acs');
    warn.mockRestore();
  });
});
