/**
 * The `/acs` route tree, contributed as a `RouteTreeFragment`.
 *
 * 0.2.16 hoisted these three paths out of the host's `BASE_ROUTE_CHILDREN`;
 * 0.2.80 moves them out of the host repo entirely, into this envelope. The rule
 * the plugin contract enforces is the reason: a type declares `routes` and
 * `detailPanel` together or declares neither. A detail panel in the manifest
 * with its route left behind in the host meant the host still had to know this
 * type by name — the one thing the single-abstraction gate forbids.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's hooks are typed against
 * the host's own statically-built route tree, so the factory and the
 * params/search reads are loosely typed here rather than at every call site.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { EntityVersionHistoryView } from '@c4s/plugin-runtime/ui';
import { AC_PATH_PREFIX, AC_TYPE } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { EntityNotFound } from '../../../frontend-kit/EntityNotFound.js';
import { toDetail, toEntity, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useAc } from './hooks.js';
import { AcsList } from './list-page.js';
import { AcDetail } from './detail-panel.js';

type ListSearch = { q?: string; tag?: string };

function AcsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <Pane>
      <AcsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: AC_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, q: q || undefined }),
          })
        }
        onTagToggle={(tag) =>
          navigate({
            to: AC_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => toDetail(navigate, AC_PATH_PREFIX, slug)}
      />
    </Pane>
  );
}

/**
 * `RouteBody`, not `Pane`: the detail panel renders a `DocEditor`, and the chips
 * inside it resolve the host's editor bridge from React context.
 */
function AcDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;
  const { data: ac } = useAc(slug);

  return (
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar type={AC_TYPE} slug={slug} name={ac?.title} view="details" />
      <AcDetail
        key={slug}
        slug={slug}
        onDeleted={() => toList(navigate, AC_PATH_PREFIX)}
        onRenamed={(newSlug) => toDetail(navigate, AC_PATH_PREFIX, newSlug, { replace: true })}
        onOpenEntity={(type, s) => toEntity(navigate, type, s)}
        onOpenPage={(rootId, path) => toPage(navigate, rootId, path)}
      />
    </RouteBody>
  );
}

/** `Pane`, not `RouteBody`: no `DocEditor` here, so no editor bridge. */
function AcHistoryRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: ac } = useAc(slug);
  return (
    <Pane>
      <EntityBreadcrumbBar type={AC_TYPE} slug={slug} name={ac?.title} view="history" />
      <EntityVersionHistoryView type={AC_TYPE} slug={slug} />
    </Pane>
  );
}

export const acRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
    notFoundComponent?: FC;
  }) => unknown;
  return [
    make({
      getParentRoute: () => rootRoute,
      path: AC_PATH_PREFIX,
      component: AcsIndexRoute,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${AC_PATH_PREFIX}/$slug`,
      component: AcDetailRoute,
      notFoundComponent: () => <EntityNotFound type={AC_TYPE} />,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${AC_PATH_PREFIX}/$slug/history`,
      component: AcHistoryRoute,
      notFoundComponent: () => <EntityNotFound type={AC_TYPE} />,
    }),
  ];
};
