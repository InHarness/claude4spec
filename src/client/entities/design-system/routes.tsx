/**
 * The `/design-systems` route tree, contributed as a `RouteTreeFragment`.
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
import { useDesignSystem } from '../../hooks/useDesignSystems.js';
import { DesignSystemsList } from './list-page.js';
import { DesignSystemDetail } from './detail-panel.js';

type Navigate = (opts: Record<string, unknown>) => void;
type ListSearch = { q?: string; tag?: string };

function DesignSystemsIndexRoute() {
  const search = useSearch({ strict: false }) as ListSearch;
  const navigate = useNavigate() as Navigate;
  return (
    <RoutePane>
      <DesignSystemsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: '/design-systems',
            search: (prev: ListSearch) => ({ ...prev, q: q || undefined }),
          })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/design-systems',
            search: (prev: ListSearch) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/design-systems/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function DesignSystemDetailRoute() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate() as Navigate;
  const { data: ds } = useDesignSystem(slug);

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
      <EntityBreadcrumbBar type="design-system" slug={slug} name={ds?.name} view="details" />
      <EditorBridgeProvider bridge={bridge}>
        <DesignSystemDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/design-systems' })}
          onRenamed={(newSlug) =>
            navigate({ to: '/design-systems/$slug', params: { slug: newSlug }, replace: true })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(rid, p) => navigate({ to: '/space/$rootId/$', params: { rootId: rid, _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

export const designSystemRoutes: RouteTreeFragment = ({ rootRoute }) => [
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/design-systems',
    validateSearch: listSearchSchema,
    component: DesignSystemsIndexRoute,
  }),
  makeFragmentRoute({
    getParentRoute: () => rootRoute,
    path: '/design-systems/$slug',
    component: DesignSystemDetailRoute,
    notFoundComponent: () => <EntityNotFound type="design-system" />,
  }),
];
