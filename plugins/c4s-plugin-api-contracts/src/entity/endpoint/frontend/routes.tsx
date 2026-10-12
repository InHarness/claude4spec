/**
 * The `/endpoints` route tree, contributed as a `RouteTreeFragment`.
 *
 * These three paths used to be hardcoded in the host's `router.tsx`, together
 * with the wrapper components below. They move with the type: a delivered
 * frontend gets its routes merged into the host's single router at mount, which
 * is the same door the external `database-table` plugin already uses.
 *
 * `AnyRoute` is opaque in the Host API and TanStack's hooks are typed against
 * the host's own route tree, so the factory and the params/search reads are
 * loosely typed here rather than at every call site.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Trash } from 'lucide-react';
import { ActionButton, EntityVersionHistoryView } from '@c4s/plugin-runtime/ui';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { ENDPOINT_PATH_PREFIX, ENDPOINT_TYPE } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { toDetail, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useDeleteEndpoint, useEndpoint } from './hooks.js';
import { confirmAndDeleteEndpoint } from './delete-confirm.js';
import { EndpointsList } from './list-page.js';
import { EndpointDetail } from './detail-panel.js';

type ListSearch = { q?: string; tag?: string };

export function EndpointsIndexRoute() {
  const navigate = useNavigate() as Navigate;
  const search = useSearch({ strict: false }) as ListSearch;
  return (
    <Pane>
      <EndpointsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: ENDPOINT_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, q: q || undefined }),
          })
        }
        onTagToggle={(tag) =>
          navigate({
            to: ENDPOINT_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => toDetail(navigate, ENDPOINT_PATH_PREFIX, slug)}
      />
    </Pane>
  );
}

/**
 * 2.1.16 (M13 detail pattern, `endpoint-detail`) — the ROUTE renders the
 * breadcrumb (ending with the endpoint's method and path), the view switcher
 * and Delete; there is no Edit button (fields edit in place and save
 * themselves). Delete asks through the host's confirmation window
 * (`endpoint-delete`), then goes to the list.
 */
export function EndpointDetailRoute() {
  const navigate = useNavigate() as Navigate;
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: endpoint } = useEndpoint(slug);
  const remove = useDeleteEndpoint();

  async function handleDelete() {
    if (!endpoint) return;
    if (await confirmAndDeleteEndpoint(endpoint, (s) => remove.mutateAsync(s))) {
      toList(navigate, ENDPOINT_PATH_PREFIX);
    }
  }

  return (
    // RouteBody, not Pane: the detail panel renders a DocEditor for the
    // description, and the chips inside it need the host's editor bridge.
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar
        type={ENDPOINT_TYPE}
        slug={slug}
        method={endpoint?.method}
        path={endpoint?.path}
        view="details"
        hasHistory
        actions={
          endpoint ? (
            <ActionButton
              variant="ghost"
              icon={<Trash size={12} />}
              label="Delete"
              onClick={() => void handleDelete()}
              disabled={remove.isPending}
            />
          ) : undefined
        }
      />
      <EndpointDetail
        // Resets the draft when navigating straight between two endpoints.
        key={slug}
        slug={slug}
        onDeleted={() => toList(navigate, ENDPOINT_PATH_PREFIX)}
        onRenamed={(newSlug) => toDetail(navigate, ENDPOINT_PATH_PREFIX, newSlug, { replace: true })}
        onOpenPage={(rootId, path) => toPage(navigate, rootId, path)}
      />
    </RouteBody>
  );
}

/**
 * 2.1.16 (`endpoint-history`) — a sibling route of the detail, not a panel in
 * it: the kit's `EntityVersionHistoryView` gets only the type and the slug. Its
 * empty state (no versions yet, or a deleted entity) is the kit's own.
 */
export function EndpointHistoryRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: endpoint } = useEndpoint(slug);
  return (
    <Pane>
      <EntityBreadcrumbBar
        type={ENDPOINT_TYPE}
        slug={slug}
        method={endpoint?.method}
        path={endpoint?.path}
        view="history"
        hasHistory
      />
      <EntityVersionHistoryView type={ENDPOINT_TYPE} slug={slug} />
    </Pane>
  );
}

export const endpointRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
  }) => unknown;
  return [
    make({ getParentRoute: () => rootRoute, path: ENDPOINT_PATH_PREFIX, component: EndpointsIndexRoute }),
    make({
      getParentRoute: () => rootRoute,
      path: `${ENDPOINT_PATH_PREFIX}/$slug`,
      component: EndpointDetailRoute,
    }),
    make({
      getParentRoute: () => rootRoute,
      path: `${ENDPOINT_PATH_PREFIX}/$slug/history`,
      component: EndpointHistoryRoute,
    }),
  ];
};
