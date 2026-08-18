/**
 * The `/design-systems` route tree, contributed as a `RouteTreeFragment`.
 *
 * 0.2.16 hoisted these out of the host's `BASE_ROUTE_CHILDREN`; 0.2.18 moves
 * them out of the host repo entirely, into this envelope.
 *
 * 0.2.28 added the history route. Details/History is the app's basic pattern —
 * `endpoint`, `dto`, `ac` and `database-table` all carry it — and this type and
 * `ui-view` were the only two without one, for no recorded reason. Version
 * history itself needed nothing: the service is host-wide and keyed by
 * `(type, slug)`, so it answered for this type all along; only the route was
 * missing.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's hooks are typed against
 * the host's own route tree, so the factory and the params/search reads are
 * loosely typed here rather than at every call site.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { DESIGN_SYSTEM_PATH_PREFIX, DESIGN_SYSTEM_TYPE } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { DEFAULT_VIEWS } from '../../../frontend-kit/EntityViewSwitcher.js';
import { EntityNotFound } from '../../../frontend-kit/EntityNotFound.js';
import { toDetail, toEntity, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useDesignSystem } from './hooks.js';
import { DesignSystemsList } from './list-page.js';
import { DesignSystemDetail } from './detail-panel.js';
import { EntityVersionHistoryView } from '@c4s/plugin-runtime/ui';

type ListSearch = { q?: string; tag?: string };

function DesignSystemsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <Pane>
      <DesignSystemsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: DESIGN_SYSTEM_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, q: q || undefined }),
          })
        }
        onTagToggle={(tag) =>
          navigate({
            to: DESIGN_SYSTEM_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => toDetail(navigate, DESIGN_SYSTEM_PATH_PREFIX, slug)}
      />
    </Pane>
  );
}

function DesignSystemDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;
  const { data: ds } = useDesignSystem(slug);

  return (
    // RouteBody, not Pane: the detail panel renders a DocEditor for the
    // description, and the chips inside it need the host's editor bridge.
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar type={DESIGN_SYSTEM_TYPE} slug={slug} name={ds?.title} view="details" views={DEFAULT_VIEWS} />
      <DesignSystemDetail
        key={slug}
        slug={slug}
        onDeleted={() => toList(navigate, DESIGN_SYSTEM_PATH_PREFIX)}
        onRenamed={(newSlug) =>
          toDetail(navigate, DESIGN_SYSTEM_PATH_PREFIX, newSlug, { replace: true })
        }
        onOpenEntity={(type, s) => toEntity(navigate, type, s)}
        onOpenPage={(rootId, path) => toPage(navigate, rootId, path)}
      />
    </RouteBody>
  );
}

/** `Pane`, not `RouteBody`: no `DocEditor` here, so no editor bridge. */
function DesignSystemHistoryRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: ds } = useDesignSystem(slug);
  return (
    <Pane>
      <EntityBreadcrumbBar type={DESIGN_SYSTEM_TYPE} slug={slug} name={ds?.title} view="history" views={DEFAULT_VIEWS} />
      <EntityVersionHistoryView type={DESIGN_SYSTEM_TYPE} slug={slug} />
    </Pane>
  );
}

export const designSystemRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
    notFoundComponent?: FC;
  }) => unknown;
  return [
    make({
      getParentRoute: () => rootRoute,
      path: DESIGN_SYSTEM_PATH_PREFIX,
      component: DesignSystemsIndexRoute,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${DESIGN_SYSTEM_PATH_PREFIX}/$slug`,
      component: DesignSystemDetailRoute,
      notFoundComponent: () => <EntityNotFound type={DESIGN_SYSTEM_TYPE} />,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${DESIGN_SYSTEM_PATH_PREFIX}/$slug/history`,
      component: DesignSystemHistoryRoute,
      notFoundComponent: () => <EntityNotFound type={DESIGN_SYSTEM_TYPE} />,
    }),
  ];
};
