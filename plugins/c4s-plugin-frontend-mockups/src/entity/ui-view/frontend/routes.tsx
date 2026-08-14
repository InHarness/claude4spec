/**
 * The `/ui-views` route tree, contributed as a `RouteTreeFragment`.
 *
 * 0.2.16 hoisted these out of the host's `BASE_ROUTE_CHILDREN`; 0.2.18 moves
 * them out of the host repo entirely, into this envelope. The route SHAPE is
 * unchanged — an index and a detail, no history route — because the breadcrumb
 * never advertised one for this type.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's hooks are typed against
 * the host's own route tree, so the factory and the params/search reads are
 * loosely typed here rather than at every call site.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { UI_VIEW_PATH_PREFIX, UI_VIEW_TYPE } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { EntityNotFound } from '../../../frontend-kit/EntityNotFound.js';
import { toDetail, toEntity, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useUiView } from './hooks.js';
import { UiViewsList } from './list-page.js';
import { UiViewDetail } from './detail-panel.js';

type ListSearch = { q?: string; tag?: string };

function UiViewsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <Pane>
      <UiViewsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: UI_VIEW_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, q: q || undefined }),
          })
        }
        onTagToggle={(tag) =>
          navigate({
            to: UI_VIEW_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => toDetail(navigate, UI_VIEW_PATH_PREFIX, slug)}
      />
    </Pane>
  );
}

function UiViewDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;
  const { data: uiView } = useUiView(slug);

  return (
    // RouteBody, not Pane: the detail panel renders a DocEditor for the
    // description, and the chips inside it need the host's editor bridge.
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar type={UI_VIEW_TYPE} slug={slug} name={uiView?.title} view="details" />
      <UiViewDetail
        // Resets the draft when navigating straight between two views.
        key={slug}
        slug={slug}
        onDeleted={() => toList(navigate, UI_VIEW_PATH_PREFIX)}
        onRenamed={(newSlug) => toDetail(navigate, UI_VIEW_PATH_PREFIX, newSlug, { replace: true })}
        onOpenEntity={(type, s) => toEntity(navigate, type, s)}
        onOpenPage={(rootId, path) => toPage(navigate, rootId, path)}
      />
    </RouteBody>
  );
}

export const uiViewRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
    notFoundComponent?: FC;
  }) => unknown;
  return [
    make({ getParentRoute: () => rootRoute, path: UI_VIEW_PATH_PREFIX, component: UiViewsIndexRoute }),
    make({
      getParentRoute: () => rootRoute,
      path: `${UI_VIEW_PATH_PREFIX}/$slug`,
      component: UiViewDetailRoute,
      notFoundComponent: () => <EntityNotFound type={UI_VIEW_TYPE} />,
    }),
  ];
};
