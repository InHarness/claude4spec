import { useEffect, useMemo } from 'react';
import {
  createRouter,
  createRootRouteWithContext,
  createRoute,
  useParams,
  useSearch,
  useNavigate,
  Navigate,
  type AnyRoute,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { RootLayout } from './App.js';
import { EditorToolbar } from './components/EditorToolbar.js';
import { EmptyState } from './components/EmptyState.js';
import { Editor } from './components/Editor.js';
import { PageVersionHistory } from './components/PageVersionHistory.js';
import { HtmlViewer } from './components/HtmlViewer.js';
import { EndpointsList } from './entities/endpoint/list-page.js';
import { DtosList } from './entities/dto/list-page.js';
import { UiViewsList } from './entities/ui-view/list-page.js';
import { AcsList } from './entities/ac/list-page.js';
import { DesignSystemsList } from './entities/design-system/list-page.js';
import { TagsList } from './components/TagsList.js';
import { TodosList } from './components/TodosList.js';
import { PageLinksList } from './components/PageLinksList.js';
import { PlanPage } from './components/PlanPage.js';
import { ReleasesList } from './components/ReleasesList.js';
import { PlansListPage } from './components/PlansListPage.js';
import { ReleaseDetail } from './components/ReleaseDetail.js';
import { BriefsList } from './components/BriefsList.js';
import { BriefDetail } from './components/BriefDetail.js';
import { PatchDetail } from './components/PatchDetail.js';
import { OnboardingPage } from './components/onboarding/OnboardingPage.js';
import { WelcomePage } from './components/onboarding/WelcomePage.js';
import { SettingsPage } from './components/settings/SettingsPage.js';
import { EndpointDetail } from './entities/endpoint/detail-panel.js';
import { DtoDetail } from './entities/dto/detail-panel.js';
import { UiViewDetail } from './entities/ui-view/detail-panel.js';
import { AcDetail } from './entities/ac/detail-panel.js';
import { DesignSystemDetail } from './entities/design-system/detail-panel.js';
import { VersionHistory } from './components/VersionHistory.js';
import { usePages } from './hooks/usePages.js';
import { useEndpoint } from './hooks/useEndpoints.js';
import { useDto } from './hooks/useDtos.js';
import { useUiView } from './hooks/useUiViews.js';
import { useDesignSystem } from './hooks/useDesignSystems.js';
import { EntityDetailToolbar } from './entities/_shared/EntityDetailToolbar.js';
import { EditorBridgeProvider } from './tiptap/EditorContext.js';
import { usePageViewStore } from './state/pageView.js';
import type { EntityType } from '../shared/entities.js';
import type { PageNode } from '../shared/types.js';
import { clientPluginHost } from './core/plugin-host/host.js';
import { PROJECT_ID } from './lib/api-core.js';

/**
 * Resolve a TanStack Router navigate target for an entity type/slug pair via
 * the plugin host's `pathPrefix` slot. Avoids hardcoded type → URL switches
 * across the router.
 */
type NavigateFn = ReturnType<typeof useNavigate>;

// M33 phase 3: exported so a de-hardcoded entity route fragment (e.g. the
// transitional `database-table/routes.tsx`) reuses the SAME host navigation
// helpers instead of duplicating the type→URL resolution.
export function navigateToEntity(navigate: NavigateFn, type: EntityType, slug: string): void {
  const mod = clientPluginHost.getEntity(type) ?? clientPluginHost.getAvailable(type);
  if (!mod) return;
  navigate({ to: `${mod.pathPrefix}/$slug`, params: { slug } } as never);
}

function navigateToEntityList(navigate: NavigateFn, type: EntityType): void {
  const mod = clientPluginHost.getEntity(type) ?? clientPluginHost.getAvailable(type);
  if (!mod) return;
  navigate({ to: mod.pathPrefix } as never);
}

export function navigateToSection(navigate: NavigateFn, pagePath: string, anchor: string): void {
  navigate({ to: '/pages/$', params: { _splat: pagePath }, hash: `anchor-${anchor}` } as never);
}

export interface RouterContext {
  queryClient: QueryClient;
}

// M33 phase 3: exported so a de-hardcoded entity route fragment reuses the exact
// list search-param schema the host's other list routes use.
export const listSearchSchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
});

/**
 * M33 phase 3: the single host root route. Exported so a `RouteTreeFragment`
 * factory can attach its routes via `createRoute({ getParentRoute: () => rootRoute })`.
 */
export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRoute,
});

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages/$',
  component: PageRoute,
});

const endpointsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints',
  validateSearch: listSearchSchema,
  component: EndpointsIndexRoute,
});

const endpointDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints/$slug',
  component: EndpointDetailRoute,
  notFoundComponent: () => <EntityNotFound type="endpoint" />,
});

const endpointHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints/$slug/history',
  component: EndpointHistoryRoute,
});

const dtosIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dtos',
  validateSearch: listSearchSchema,
  component: DtosIndexRoute,
});

const dtoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dtos/$slug',
  component: DtoDetailRoute,
  notFoundComponent: () => <EntityNotFound type="dto" />,
});

const dtoHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dtos/$slug/history',
  component: DtoHistoryRoute,
});

// M33 phase 3: the 3 `/database-tables` routes are no longer hardcoded here.
// They are contributed as a `RouteTreeFragment` by the `database-table`
// FrontendModule shipped in the preinstalled `c4s-plugin-simple-database-tables`
// plugin (the in-host built-in module was removed in brief 0-1-82-to-0-1-83), and
// mounted by `mountFrontend` once the plugin's frontend bundle loads.

const uiViewsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ui-views',
  validateSearch: listSearchSchema,
  component: UiViewsIndexRoute,
});

const uiViewDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ui-views/$slug',
  component: UiViewDetailRoute,
  notFoundComponent: () => <EntityNotFound type="ui-view" />,
});

const designSystemsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design-systems',
  validateSearch: listSearchSchema,
  component: DesignSystemsIndexRoute,
});

const designSystemDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design-systems/$slug',
  component: DesignSystemDetailRoute,
  notFoundComponent: () => <EntityNotFound type="design-system" />,
});

const acsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/acs',
  validateSearch: listSearchSchema,
  component: AcsIndexRoute,
});

const acDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/acs/$slug',
  component: AcDetailRoute,
  notFoundComponent: () => <EntityNotFound type="ac" />,
});

const acHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/acs/$slug/history',
  component: AcHistoryRoute,
});

const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tags',
  component: TagsRoute,
});

const todosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/todos',
  component: TodosRoute,
});

const linksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/links',
  component: LinksIndexRoute,
});

const plansIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans',
  component: PlansIndexRoute,
});

const planDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans/$planId',
  component: PlanRoute,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

// Decision #11: project-less route (basepath '/' when no PROJECT_ID is injected).
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  component: WelcomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
});

const releasesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/releases',
  component: ReleasesIndexRoute,
});

const releaseDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/releases/$idOrName',
  component: ReleaseDetailRoute,
});

const briefsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/briefs',
  component: BriefsIndexRoute,
});

const briefDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/briefs/$path',
  component: BriefDetailRoute,
});

const patchDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patches/$path',
  component: PatchDetailRoute,
});

/**
 * M33 phase 3: the host's STATIC routes — every route the host owns directly,
 * minus the de-hardcoded `/database-tables` routes (now a `RouteTreeFragment`).
 * Frozen and treated as immutable: `rebuildRouteTree` always rebuilds the tree
 * from this base + the current plugin routes, so re-mounting (hot-reload) never
 * accumulates stale routes. NOTE: intentionally NOT annotated `AnyRoute[]` — the
 * literal's inferred union type is what gives `createAppRouter` (and thus the
 * registered router) its statically-typed navigation.
 */
export const BASE_ROUTE_CHILDREN = Object.freeze([
  indexRoute,
  pageRoute,
  endpointsIndexRoute,
  endpointDetailRoute,
  endpointHistoryRoute,
  dtosIndexRoute,
  dtoDetailRoute,
  dtoHistoryRoute,
  uiViewsIndexRoute,
  uiViewDetailRoute,
  designSystemsIndexRoute,
  designSystemDetailRoute,
  acsIndexRoute,
  acDetailRoute,
  acHistoryRoute,
  tagsRoute,
  todosRoute,
  linksRoute,
  plansIndexRoute,
  planDetailRoute,
  onboardingRoute,
  welcomeRoute,
  settingsRoute,
  releasesIndexRoute,
  releaseDetailRoute,
  briefsIndexRoute,
  briefDetailRoute,
  patchDetailRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    // Stand the host up with ONLY the base routes; plugin routes are mounted
    // afterwards via `rebuildRouteTree` (see `mountFrontend`).
    routeTree: rootRoute.addChildren([...BASE_ROUTE_CHILDREN]),
    context: { queryClient },
    defaultPreload: 'intent',
    // M31: the SPA is served under /p/<project-id>/ — in-app routes stay
    // basepath-relative ('/pages/$', '/settings', …).
    basepath: PROJECT_ID ? `/p/${PROJECT_ID}` : '/',
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/**
 * M33 phase 3: remount the router's route tree as BASE ∪ `pluginRoutes`. Centralizes
 * the TanStack-internal workaround: `router.update({ routeTree })` silently no-ops
 * when the `routeTree` reference is unchanged (and `addChildren` returns the same
 * `rootRoute`), so we rebuild the processed tree directly via
 * `setRoutes(buildRouteTree())` then `invalidate()` to re-match the current location.
 * Rebuilding from the frozen base each call makes it idempotent for hot-reload.
 */
export function rebuildRouteTree(router: AppRouter, pluginRoutes: AnyRoute[]): void {
  // The combined tree is dynamic (plugin routes leave the static route-tree type),
  // so this branch is deliberately untyped — `addChildren` only needs the runtime
  // route objects, and `setRoutes`/`invalidate` re-derive matching from them.
  rootRoute.addChildren([...BASE_ROUTE_CHILDREN, ...pluginRoutes] as unknown as AnyRoute[]);
  router.setRoutes(router.buildRouteTree());
  void router.invalidate();
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

// M33 phase 3: exported for the transitional `database-table/routes.tsx` fragment.
export function RoutePane({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex-1 flex flex-col min-w-0 h-full"
      style={{ background: 'var(--c-bg)' }}
    >
      {children}
    </main>
  );
}

function IndexRoute() {
  const { data: tree = [] } = usePages();
  const firstPage = useMemo(() => firstLeaf(tree), [tree]);
  if (firstPage) {
    return <Navigate to="/pages/$" params={{ _splat: firstPage.path }} replace />;
  }
  return (
    <RoutePane>
      <EmptyState onNewPage={promptNewPage} />
    </RoutePane>
  );
}

function PageRoute() {
  const { _splat } = useParams({ from: '/pages/$' });
  const path = _splat ?? '';
  const navigate = useNavigate();
  const pageView = usePageViewStore((s) => s.pageView);
  const setPageView = usePageViewStore((s) => s.setPageView);
  useEffect(() => {
    setPageView('editor');
  }, [path, setPageView]);
  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, slug: string) => navigateToEntity(navigate, type, slug),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );
  // M30: shared /pages/$ route branches by file type — .html renders the read-only viewer,
  // .md renders the Tiptap editor. HtmlViewer carries its own header (no version history).
  if (path.toLowerCase().endsWith('.html')) {
    return (
      <RoutePane>
        <HtmlViewer path={path} />
      </RoutePane>
    );
  }
  return (
    <RoutePane>
      <EditorToolbar path={path} />
      <EditorBridgeProvider bridge={bridge}>
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {pageView === 'history' ? (
            <PageVersionHistory path={path} onBack={() => setPageView('editor')} />
          ) : (
            <Editor
              key={path}
              path={path}
              onOpenEntity={bridge.openEntity}
              onOpenSection={bridge.openSection}
            />
          )}
        </div>
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function EndpointsIndexRoute() {
  const search = useSearch({ from: '/endpoints' });
  const navigate = useNavigate();
  return (
    <RoutePane>
      <EndpointsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/endpoints', search: (prev) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/endpoints',
            search: (prev) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/endpoints/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function EndpointDetailRoute() {
  const { slug } = useParams({ from: '/endpoints/$slug' });
  const navigate = useNavigate();
  const { data: endpoint } = useEndpoint(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );

  return (
    <RoutePane>
      <EntityDetailToolbar
        type="endpoint"
        slug={slug}
        method={endpoint?.method}
        path={endpoint?.path}
        view="details"
        hasHistory
      />
      <EditorBridgeProvider bridge={bridge}>
        <EndpointDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/endpoints' })}
          onRenamed={(newSlug) =>
            navigate({ to: '/endpoints/$slug', params: { slug: newSlug }, replace: true })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(p) => navigate({ to: '/pages/$', params: { _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function EndpointHistoryRoute() {
  const { slug } = useParams({ from: '/endpoints/$slug/history' });
  const navigate = useNavigate();
  const { data: endpoint } = useEndpoint(slug);

  return (
    <RoutePane>
      <EntityDetailToolbar
        type="endpoint"
        slug={slug}
        method={endpoint?.method}
        path={endpoint?.path}
        view="history"
        hasHistory
      />
      <VersionHistory
        type="endpoint"
        slug={slug}
        onBack={() => navigate({ to: '/endpoints/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function DtosIndexRoute() {
  const search = useSearch({ from: '/dtos' });
  const navigate = useNavigate();
  return (
    <RoutePane>
      <DtosList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/dtos', search: (prev) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/dtos',
            search: (prev) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/dtos/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function DtoDetailRoute() {
  const { slug } = useParams({ from: '/dtos/$slug' });
  const navigate = useNavigate();
  const { data: dto } = useDto(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );

  return (
    <RoutePane>
      <EntityDetailToolbar type="dto" slug={slug} name={dto?.name} view="details" hasHistory />
      <EditorBridgeProvider bridge={bridge}>
        <DtoDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/dtos' })}
          onRenamed={(newSlug) =>
            navigate({ to: '/dtos/$slug', params: { slug: newSlug }, replace: true })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(p) => navigate({ to: '/pages/$', params: { _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function DtoHistoryRoute() {
  const { slug } = useParams({ from: '/dtos/$slug/history' });
  const navigate = useNavigate();
  const { data: dto } = useDto(slug);

  return (
    <RoutePane>
      <EntityDetailToolbar type="dto" slug={slug} name={dto?.name} view="history" hasHistory />
      <VersionHistory
        type="dto"
        slug={slug}
        onBack={() => navigate({ to: '/dtos/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function UiViewsIndexRoute() {
  const search = useSearch({ from: '/ui-views' });
  const navigate = useNavigate();
  return (
    <RoutePane>
      <UiViewsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/ui-views', search: (prev) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/ui-views',
            search: (prev) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/ui-views/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function UiViewDetailRoute() {
  const { slug } = useParams({ from: '/ui-views/$slug' });
  const navigate = useNavigate();
  const { data: uiView } = useUiView(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );

  return (
    <RoutePane>
      <EntityDetailToolbar type="ui-view" slug={slug} name={uiView?.name} view="details" />
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
          onOpenPage={(p) => navigate({ to: '/pages/$', params: { _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function DesignSystemsIndexRoute() {
  const search = useSearch({ from: '/design-systems' });
  const navigate = useNavigate();
  return (
    <RoutePane>
      <DesignSystemsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/design-systems', search: (prev) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/design-systems',
            search: (prev) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/design-systems/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function DesignSystemDetailRoute() {
  const { slug } = useParams({ from: '/design-systems/$slug' });
  const navigate = useNavigate();
  const { data: ds } = useDesignSystem(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );

  return (
    <RoutePane>
      <EntityDetailToolbar type="design-system" slug={slug} name={ds?.name} view="details" />
      <EditorBridgeProvider bridge={bridge}>
        <DesignSystemDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/design-systems' })}
          onRenamed={(newSlug) =>
            navigate({ to: '/design-systems/$slug', params: { slug: newSlug }, replace: true })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(p) => navigate({ to: '/pages/$', params: { _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function AcsIndexRoute() {
  const search = useSearch({ from: '/acs' });
  const navigate = useNavigate();
  return (
    <RoutePane>
      <AcsList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/acs', search: (prev) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/acs',
            search: (prev) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/acs/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function AcDetailRoute() {
  const { slug } = useParams({ from: '/acs/$slug' });
  const navigate = useNavigate();

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate],
  );

  return (
    <RoutePane>
      <EntityDetailToolbar type="ac" slug={slug} view="details" hasHistory />
      <EditorBridgeProvider bridge={bridge}>
        <AcDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/acs' })}
          onRenamed={(newSlug) =>
            navigate({ to: '/acs/$slug', params: { slug: newSlug }, replace: true })
          }
          onOpenEntity={bridge.openEntity}
          onOpenPage={(p) => navigate({ to: '/pages/$', params: { _splat: p } })}
        />
      </EditorBridgeProvider>
    </RoutePane>
  );
}

function AcHistoryRoute() {
  const { slug } = useParams({ from: '/acs/$slug/history' });
  const navigate = useNavigate();

  return (
    <RoutePane>
      <EntityDetailToolbar type="ac" slug={slug} view="history" hasHistory />
      <VersionHistory
        type="ac"
        slug={slug}
        onBack={() => navigate({ to: '/acs/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function TagsRoute() {
  return (
    <RoutePane>
      <TagsList />
    </RoutePane>
  );
}

function TodosRoute() {
  return (
    <RoutePane>
      <TodosList />
    </RoutePane>
  );
}

function LinksIndexRoute() {
  return (
    <RoutePane>
      <PageLinksList />
    </RoutePane>
  );
}

function ReleasesIndexRoute() {
  return (
    <RoutePane>
      <ReleasesList />
    </RoutePane>
  );
}

function ReleaseDetailRoute() {
  const { idOrName } = useParams({ from: '/releases/$idOrName' });
  return (
    <RoutePane>
      <ReleaseDetail idOrName={idOrName} />
    </RoutePane>
  );
}

function PlansIndexRoute() {
  return (
    <RoutePane>
      <PlansListPage />
    </RoutePane>
  );
}

function BriefsIndexRoute() {
  return (
    <RoutePane>
      <BriefsList />
    </RoutePane>
  );
}

function BriefDetailRoute() {
  const { path } = useParams({ from: '/briefs/$path' });
  // path comes URL-encoded (encodeBriefPath splits on '/'); decode each segment.
  const decoded = path.split('/').map(decodeURIComponent).join('/');
  return (
    <main className="flex-1 flex flex-col min-w-0 h-full" style={{ background: 'var(--c-bg)' }}>
      <BriefDetail key={decoded} briefPath={decoded} />
    </main>
  );
}

function PatchDetailRoute() {
  const { path } = useParams({ from: '/patches/$path' });
  // path comes URL-encoded (encodePatchPath splits on '/'); decode each segment.
  const decoded = path.split('/').map(decodeURIComponent).join('/');
  return (
    <main className="flex-1 flex flex-col min-w-0 h-full" style={{ background: 'var(--c-bg)' }}>
      <PatchDetail key={decoded} patchPath={decoded} />
    </main>
  );
}

function SettingsRoute() {
  return (
    <RoutePane>
      <SettingsPage />
    </RoutePane>
  );
}

function PlanRoute() {
  const { planId } = useParams({ from: '/plans/$planId' });
  const navigate = useNavigate();
  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, slug: string) => navigateToEntity(navigate, type, slug),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );
  const id = Number(planId);
  if (!Number.isInteger(id)) {
    return (
      <RoutePane>
        <div
          className="flex-1 flex items-center justify-center text-[13px]"
          style={{ color: 'var(--c-muted)' }}
        >
          Invalid plan id.
        </div>
      </RoutePane>
    );
  }
  return (
    <main
      className="flex-1 flex flex-col min-w-0 h-full"
      style={{ background: 'var(--c-bg)' }}
    >
      <EditorBridgeProvider bridge={bridge}>
        <PlanPage key={id} planId={id} />
      </EditorBridgeProvider>
    </main>
  );
}

// M33 phase 3: exported for the transitional `database-table/routes.tsx` fragment.
export function EntityNotFound({ type }: { type: EntityType }) {
  const navigate = useNavigate();
  const mod = clientPluginHost.getAvailable(type);
  const label = mod?.label ?? 'Entity';
  const listLabel = mod?.labelPlural ?? 'Entities';
  function goBack() {
    navigateToEntityList(navigate, type);
  }
  return (
    <RoutePane>
      <div className="flex-1 flex items-center justify-center px-10">
        <div className="max-w-md text-center" style={{ color: 'var(--c-muted)' }}>
          <div className="text-[15px] font-semibold mb-2" style={{ color: 'var(--c-ink)' }}>
            {label} not found
          </div>
          <div className="text-[12.5px] mb-4" style={{ color: 'var(--c-subtle)' }}>
            The {type} slug in the URL does not match any entity in the database.
          </div>
          <button
            onClick={goBack}
            className="rounded-md px-3 py-1.5 text-[12.5px]"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Back to {listLabel}
          </button>
        </div>
      </div>
    </RoutePane>
  );
}

function firstLeaf(nodes: PageNode[]): PageNode | null {
  for (const n of nodes) {
    if (n.type === 'file') return n;
    if (n.children) {
      const found = firstLeaf(n.children);
      if (found) return found;
    }
  }
  return null;
}

function promptNewPage() {
  window.dispatchEvent(new CustomEvent('c4s:new-page'));
}
