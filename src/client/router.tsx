import { useEffect, useMemo } from 'react';
import {
  createRouter,
  createRootRouteWithContext,
  createRoute,
  useParams,
  useSearch,
  useNavigate,
  Navigate,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { RootLayout } from './App.js';
import { EditorToolbar } from './components/EditorToolbar.js';
import { EmptyState } from './components/EmptyState.js';
import { Editor } from './components/Editor.js';
import { PageVersionHistory } from './components/PageVersionHistory.js';
import { EndpointsList } from './entities/endpoint/list-page.js';
import { DtosList } from './entities/dto/list-page.js';
import { DatabaseTablesList } from './entities/database-table/list-page.js';
import { UiViewsList } from './entities/ui-view/list-page.js';
import { AcsList } from './entities/ac/list-page.js';
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
import { EndpointDetail } from './entities/endpoint/detail-panel.js';
import { DtoDetail } from './entities/dto/detail-panel.js';
import { DatabaseTableDetail } from './entities/database-table/detail-panel.js';
import { UiViewDetail } from './entities/ui-view/detail-panel.js';
import { AcDetail } from './entities/ac/detail-panel.js';
import { VersionHistory } from './components/VersionHistory.js';
import { usePages } from './hooks/usePages.js';
import { useEndpoint } from './hooks/useEndpoints.js';
import { useDto } from './hooks/useDtos.js';
import { useDatabaseTable } from './hooks/useDatabaseTables.js';
import { useUiView } from './hooks/useUiViews.js';
import { EntityDetailToolbar } from './entities/_shared/EntityDetailToolbar.js';
import { EditorBridgeProvider } from './tiptap/EditorContext.js';
import { usePageViewStore } from './state/pageView.js';
import type { EntityType } from '../shared/entities.js';
import type { PageNode } from '../shared/types.js';
import { clientPluginHost } from './core/plugin-host/host.js';

/**
 * Resolve a TanStack Router navigate target for an entity type/slug pair via
 * the plugin host's `pathPrefix` slot. Avoids hardcoded type → URL switches
 * across the router.
 */
type NavigateFn = ReturnType<typeof useNavigate>;

function navigateToEntity(navigate: NavigateFn, type: EntityType, slug: string): void {
  const mod = clientPluginHost.getEntity(type) ?? clientPluginHost.getAvailable(type);
  if (!mod) return;
  navigate({ to: `${mod.pathPrefix}/$slug`, params: { slug } } as never);
}

function navigateToEntityList(navigate: NavigateFn, type: EntityType): void {
  const mod = clientPluginHost.getEntity(type) ?? clientPluginHost.getAvailable(type);
  if (!mod) return;
  navigate({ to: mod.pathPrefix } as never);
}

function navigateToSection(navigate: NavigateFn, pagePath: string, anchor: string): void {
  navigate({ to: '/pages/$', params: { _splat: pagePath }, hash: `anchor-${anchor}` } as never);
}

export interface RouterContext {
  queryClient: QueryClient;
}

const listSearchSchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
});

const rootRoute = createRootRouteWithContext<RouterContext>()({
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  pageRoute,
  endpointsIndexRoute,
  endpointDetailRoute,
  endpointHistoryRoute,
  dtosIndexRoute,
  dtoDetailRoute,
  dtoHistoryRoute,
  databaseTablesIndexRoute,
  databaseTableDetailRoute,
  databaseTableHistoryRoute,
  uiViewsIndexRoute,
  uiViewDetailRoute,
  acsIndexRoute,
  acDetailRoute,
  acHistoryRoute,
  tagsRoute,
  todosRoute,
  linksRoute,
  plansIndexRoute,
  planDetailRoute,
  onboardingRoute,
  releasesIndexRoute,
  releaseDetailRoute,
  briefsIndexRoute,
  briefDetailRoute,
  patchDetailRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

function RoutePane({ children }: { children: React.ReactNode }) {
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

function DatabaseTablesIndexRoute() {
  const search = useSearch({ from: '/database-tables' });
  const navigate = useNavigate();
  return (
    <RoutePane>
      <DatabaseTablesList
        search={search.q ?? ''}
        tagFilter={search.tag ? [search.tag] : []}
        onSearchChange={(q) =>
          navigate({ to: '/database-tables', search: (prev) => ({ ...prev, q: q || undefined }) })
        }
        onTagToggle={(tag) =>
          navigate({
            to: '/database-tables',
            search: (prev) => ({ ...prev, tag: prev.tag === tag ? undefined : tag }),
          })
        }
        onSelect={(slug) => navigate({ to: '/database-tables/$slug', params: { slug } })}
      />
    </RoutePane>
  );
}

function DatabaseTableDetailRoute() {
  const { slug } = useParams({ from: '/database-tables/$slug' });
  const navigate = useNavigate();
  const { data: dbTable } = useDatabaseTable(slug);

  const bridge = useMemo(
    () => ({
      openEntity: (type: EntityType, s: string) => navigateToEntity(navigate, type, s),
      openSection: (pagePath: string, anchor: string) => navigateToSection(navigate, pagePath, anchor),
    }),
    [navigate]
  );

  return (
    <RoutePane>
      <EntityDetailToolbar type="database-table" slug={slug} name={dbTable?.name} view="details" hasHistory />
      <EditorBridgeProvider bridge={bridge}>
        <DatabaseTableDetail
          key={slug}
          slug={slug}
          onDeleted={() => navigate({ to: '/database-tables' })}
          onRenamed={(newSlug) =>
            navigate({
              to: '/database-tables/$slug',
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

function DatabaseTableHistoryRoute() {
  const { slug } = useParams({ from: '/database-tables/$slug/history' });
  const navigate = useNavigate();
  const { data: dbTable } = useDatabaseTable(slug);

  return (
    <RoutePane>
      <EntityDetailToolbar type="database-table" slug={slug} name={dbTable?.name} view="history" hasHistory />
      <VersionHistory
        type="database-table"
        slug={slug}
        onBack={() => navigate({ to: '/database-tables/$slug', params: { slug } })}
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

function PlanRoute() {
  const { planId } = useParams({ from: '/plans/$planId' });
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
      <PlanPage key={id} planId={id} />
    </main>
  );
}

function EntityNotFound({ type }: { type: EntityType }) {
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
