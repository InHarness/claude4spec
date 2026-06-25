/**
 * M33 phase 3 — the built-in `database-table` entity's page routes, as a
 * `RouteTreeFragment`.
 *
 * TRANSITIONAL. These 3 routes used to be hardcoded in `client/router.tsx`. They
 * now ship as the `database-table` FrontendModule's `routes` factory so the host
 * router is no longer hardcoded per-entity (the generic mechanism Phase 3 adds).
 * This file disappears with the built-in `database-table` entity (the user's
 * separate removal PR); the EXTERNAL workspace plugin contributes the same `type`
 * and — being loaded async after the built-in — overrides the type slot, so its
 * routes win once it has loaded.
 *
 * Because these routes are NOT part of the host's statically-registered route
 * tree, the typed route-literals (`useParams({ from })`, `navigate({ to })`,
 * `useSearch`) no longer resolve — hence the `as never` casts. They reuse the
 * host-internal frame (`RoutePane`, `EntityDetailToolbar`, `VersionHistory`,
 * `EntityNotFound`) and navigation helpers exported from `router.tsx`.
 */

import { useMemo } from 'react';
import { createRoute, useParams, useSearch, useNavigate, type AnyRoute } from '@tanstack/react-router';
import type { EntityType } from '../../../shared/entities.js';
import type { RouteTreeFragment } from '../../core/plugin-host/types.js';
import {
  RoutePane,
  EntityNotFound,
  navigateToEntity,
  navigateToSection,
  listSearchSchema,
} from '../../router.js';
import { EntityDetailToolbar } from '../_shared/EntityDetailToolbar.js';
import { EditorBridgeProvider } from '../../tiptap/EditorContext.js';
import { VersionHistory } from '../../components/VersionHistory.js';
import { DatabaseTablesList } from './list-page.js';
import { DatabaseTableDetail } from './detail-panel.js';
import { useDatabaseTable } from '../../hooks/useDatabaseTables.js';

function DatabaseTablesIndexRoute() {
  const search = useSearch({ from: '/database-tables' as never }) as { q?: string; tag?: string };
  const navigate = useNavigate();
  return (
    <RoutePane>
      <DatabaseTablesList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({
            to: '/database-tables',
            search: (prev: Record<string, unknown>) => ({ ...prev, q: q || undefined }),
          } as never)
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/database-tables',
            search: (prev: { tag?: string }) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          } as never)
        }
        onSelect={(slug) => navigate({ to: '/database-tables/$slug', params: { slug } } as never)}
      />
    </RoutePane>
  );
}

function DatabaseTableDetailRoute() {
  const { slug } = useParams({ from: '/database-tables/$slug' as never }) as { slug: string };
  const navigate = useNavigate();
  const { data: dbTable } = useDatabaseTable(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate],
  );

  return (
    <RoutePane>
      <EntityDetailToolbar type="database-table" slug={slug} name={dbTable?.name} view="details" hasHistory />
      <EditorBridgeProvider bridge={bridge}>
        <DatabaseTableDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/database-tables' } as never)}
          onRenamed={(newSlug) =>
            navigate({ to: '/database-tables/$slug', params: { slug: newSlug }, replace: true } as never)
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(p) => navigate({ to: '/pages/$', params: { _splat: p } } as never)}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function DatabaseTableHistoryRoute() {
  const { slug } = useParams({ from: '/database-tables/$slug/history' as never }) as { slug: string };
  const navigate = useNavigate();
  const { data: dbTable } = useDatabaseTable(slug);

  return (
    <RoutePane>
      <EntityDetailToolbar type="database-table" slug={slug} name={dbTable?.name} view="history" hasHistory />
      <VersionHistory
        type="database-table"
        slug={slug}
        onBack={() => navigate({ to: '/database-tables/$slug', params: { slug } } as never)}
      />
    </RoutePane>
  );
}

/**
 * The fragment factory: build the 3 routes bound to the host's `rootRoute`. The
 * host calls this once in `mountFrontend` and mounts the result into its router.
 */
export const databaseTableRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const databaseTablesIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/database-tables',
    validateSearch: listSearchSchema,
    component: DatabaseTablesIndexRoute,
  });
  const databaseTableDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/database-tables/$slug',
    component: DatabaseTableDetailRoute,
    notFoundComponent: () => <EntityNotFound type="database-table" />,
  });
  const databaseTableHistoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/database-tables/$slug/history',
    component: DatabaseTableHistoryRoute,
  });
  // These routes leave the host's static route-tree type → cast for the fragment.
  return [
    databaseTablesIndexRoute,
    databaseTableDetailRoute,
    databaseTableHistoryRoute,
  ] as unknown as AnyRoute[];
};
