/**
 * The `/acs` route tree, contributed as a `RouteTreeFragment`.
 *
 * 0.2.16 — these three paths and their wrapper components used to be hardcoded
 * in the host's `router.tsx`, in `BASE_ROUTE_CHILDREN`. They move with the type,
 * for the reason the plugin contract now enforces: a type declares `routes` and
 * `detailPanel` together or declares neither. A detail panel sitting in the
 * manifest while its route sat in the host meant the host still had to know this
 * type by name — the one thing the single-abstraction rule forbids, and the
 * reason `endpoint`, `dto` and `database-table` were moved out before it.
 *
 * `AnyRoute` is opaque in the module contract and TanStack's hooks are typed
 * against the host's own statically-built route tree, so the params/search reads
 * here are loosely typed — the same trade the external plugin fragments make.
 */

import { useMemo } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { makeFragmentRoute } from '../_shared/route-fragment.js';
import type { RouteTreeFragment } from '../../core/plugin-host/types.js';
import type { EntityType } from '../../../shared/entities.js';
import {
  EntityNotFound,
  RoutePane,
  listSearchSchema,
  navigateToEntity,
  navigateToSection,
} from '../../router.js';
import { EntityBreadcrumbBar } from '../_shared/EntityBreadcrumbBar.js';
import { EditorBridgeProvider } from '../../tiptap/EditorContext.js';
import { EntityVersionHistoryView } from '../../host-ui-kit/index.js';
import { AcsList } from './list-page.js';
import { AcDetail } from './detail-panel.js';

type Navigate = (opts: Record<string, unknown>) => void;
type ListSearch = { q?: string; tag?: string };

function AcsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <RoutePane>
      <AcsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/acs', search: (prev: ListSearch) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/acs',
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/acs/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function AcDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate as never, type, s),
      openSection: (pagePath: string, anchor: string) =>
        navigateToSection(navigate as never, pagePath, anchor),
    }),
    [navigate],
  );

  return (
    <RoutePane>
      <EntityBreadcrumbBar type="ac" slug={slug} view="details" hasHistory />
      <EditorBridgeProvider bridge={bridge}>
        <AcDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/acs' })}
          onRenamed={(newSlug) =>
            navigate({ to: '/acs/$slug', params: { slug: newSlug }, replace: true })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(rid, p) => navigate({ to: '/space/$rootId/$', params: { rootId: rid, _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function AcHistoryRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  return (
    <RoutePane>
      <EntityBreadcrumbBar type="ac" slug={slug} view="history" hasHistory />
      <EntityVersionHistoryView type="ac" slug={slug} />
    </RoutePane>
  );
}

export const acRoutes: RouteTreeFragment = ({ rootRoute }) => [
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/acs',
    validateSearch: listSearchSchema,
    component: AcsIndexRoute,
  }),
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/acs/$slug',
    component: AcDetailRoute,
    notFoundComponent: () => <EntityNotFound type="ac" />,
  }),
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/acs/$slug/history',
    component: AcHistoryRoute,
  }),
];
