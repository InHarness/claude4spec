/**
 * The `/dtos` route tree. Same shape and rationale as the endpoint side — see
 * `entity/endpoint/frontend/routes.tsx` for why these left the host's router.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { EntityVersionHistoryView } from '@c4s/plugin-runtime/ui';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { DTO_PATH_PREFIX, DTO_TYPE, ENDPOINT_PATH_PREFIX } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { toDetail, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useDto } from './hooks.js';
import { DtosList } from './list-page.js';
import { DtoDetail } from './detail-panel.js';

type ListSearch = { q?: string; tag?: string };

function DtosIndexRoute() {
  const navigate = useNavigate() as Navigate;
  const search = useSearch({ strict: false }) as ListSearch;
  return (
    <Pane>
      <DtosList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: DTO_PATH_PREFIX, search: (prev: ListSearch) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: DTO_PATH_PREFIX,
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => toDetail(navigate, DTO_PATH_PREFIX, slug)}
      />
    </Pane>
  );
}

function DtoDetailRoute() {
  const navigate = useNavigate() as Navigate;
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: dto } = useDto(slug);

  return (
    // RouteBody, not Pane — see the endpoint side: the description's DocEditor
    // needs the editor bridge, and a missing one is silent.
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar type={DTO_TYPE} slug={slug} name={dto?.title} view="details" hasHistory />
      <DtoDetail
        key={slug}
        slug={slug}
        onDeleted={() => toList(navigate, DTO_PATH_PREFIX)}
        onRenamed={(newSlug) => toDetail(navigate, DTO_PATH_PREFIX, newSlug, { replace: true })}
        // The DTO panel links out to the endpoints on the other side of the
        // junction — an intra-package navigation, so it stays a direct route
        // push rather than going through the host's editor bridge.
        onOpenEntity={(_type, endpointSlug) => toDetail(navigate, ENDPOINT_PATH_PREFIX, endpointSlug)}
        onOpenPage={(rootId, path) => toPage(navigate, rootId, path)}
      />
    </RouteBody>
  );
}

function DtoHistoryRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: dto } = useDto(slug);
  return (
    <Pane>
      <EntityBreadcrumbBar type={DTO_TYPE} slug={slug} name={dto?.title} view="history" hasHistory />
      <EntityVersionHistoryView type={DTO_TYPE} slug={slug} />
    </Pane>
  );
}

export const dtoRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
  }) => unknown;
  return [
    make({ getParentRoute: () => rootRoute, path: DTO_PATH_PREFIX, component: DtosIndexRoute }),
    make({ getParentRoute: () => rootRoute, path: `${DTO_PATH_PREFIX}/$slug`, component: DtoDetailRoute }),
    make({
      getParentRoute: () => rootRoute,
      path: `${DTO_PATH_PREFIX}/$slug/history`,
      component: DtoHistoryRoute,
    }),
  ];
};
