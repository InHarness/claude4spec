/**
 * The `/ui-views` route tree, contributed as a `RouteTreeFragment`.
 *
 * 0.2.16 — hoisted out of the host's `BASE_ROUTE_CHILDREN`; see the header of
 * `entities/ac/routes.tsx` for why a detail panel and its route now travel
 * together in the manifest.
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
import { useUiView } from '../../hooks/useUiViews.js';
import { UiViewsList } from './list-page.js';
import { UiViewDetail } from './detail-panel.js';

type Navigate = (opts: Record<string, unknown>) => void;
type ListSearch = { q?: string; tag?: string };

function UiViewsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <RoutePane>
      <UiViewsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/ui-views', search: (prev: ListSearch) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/ui-views',
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/ui-views/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function UiViewDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;
  const { data: uiView } = useUiView(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate as never, type, s),
      openSection: (pagePath: string, anchor: string) =>
        navigateToSection(navigate as never, pagePath, anchor),
    }),
    [navigate]
  );

  return (
    <RoutePane>
      <EntityBreadcrumbBar type="ui-view" slug={slug} name={uiView?.name} view="details" />
      <EditorBridgeProvider bridge={bridge}>
        <UiViewDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/ui-views' })}
          onRenamed={(newSlug) =>
            navigate({
              to: '/ui-views/$slug',
              params: { slug: newSlug },
              replace: true,
            })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(rid, p) => navigate({ to: '/space/$rootId/$', params: { rootId: rid, _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

export const uiViewRoutes: RouteTreeFragment = ({ rootRoute }) => [
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/ui-views',
    validateSearch: listSearchSchema,
    component: UiViewsIndexRoute,
  }),
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/ui-views/$slug',
    component: UiViewDetailRoute,
    notFoundComponent: () => <EntityNotFound type="ui-view" />,
  }),
];
