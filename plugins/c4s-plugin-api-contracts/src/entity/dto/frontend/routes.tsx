/**
 * The `/dtos` route tree. Same shape and rationale as the endpoint side — see
 * `entity/endpoint/frontend/routes.tsx` for why these left the host's router.
 */

import type { FC } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Trash } from 'lucide-react';
import { ActionButton, EntityVersionHistoryView } from '@c4s/plugin-runtime/ui';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { DTO_PATH_PREFIX, DTO_TYPE, ENDPOINT_PATH_PREFIX } from '../../../identity.js';
import { EntityBreadcrumbBar } from '../../../frontend-kit/EntityBreadcrumbBar.js';
import { toDetail, toList, toPage, type Navigate } from '../../../frontend-kit/navigation.js';
import { Pane, RouteBody } from '../../../frontend-kit/route-shell.js';
import { useDeleteDto, useDto } from './hooks.js';
import { confirmAndDeleteDto } from './delete-confirm.js';
import { DtosList } from './list-page.js';
import { DtoDetail } from './detail-panel.js';

type ListSearch = { q?: string; tag?: string };

export function DtosIndexRoute() {
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

/**
 * 2.1.16 (M13 detail pattern) — the ROUTE renders the breadcrumb, the view
 * switcher and Delete; there is no Edit button (fields edit in place). Delete
 * asks through the host's confirmation window (`dto-delete`), then goes to the
 * list.
 */
export function DtoDetailRoute() {
  const navigate = useNavigate() as Navigate;
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: dto } = useDto(slug);
  const remove = useDeleteDto();

  async function handleDelete() {
    if (!dto) return;
    if (await confirmAndDeleteDto(dto, (s) => remove.mutateAsync(s))) {
      toList(navigate, DTO_PATH_PREFIX);
    }
  }

  return (
    // RouteBody, not Pane — see the endpoint side: the description's DocEditor
    // needs the editor bridge, and a missing one is silent.
    <RouteBody navigate={navigate}>
      <EntityBreadcrumbBar
        type={DTO_TYPE}
        slug={slug}
        name={dto?.title}
        view="details"
        hasHistory
        actions={
          dto ? (
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
