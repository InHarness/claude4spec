// @vitest-environment happy-dom
/**
 * 2.1.46 (M28 846dmtbu, unit goal u5-shadows-ui) — a click on a shadow item in
 * the header's Shadows section opens THAT shadow on the Shadows tab on every
 * click, also after a page reload. A reload keeps what lives in the browser's
 * history (`window.history.state`, the URL) and loses everything module-scoped
 * — so the "reload" here keeps the window and its history and re-evaluates
 * every module (`vi.resetModules()` + fresh dynamic imports: React, the router,
 * React Query, the header, the screen). Whatever per-click bookkeeping the
 * header does must survive exactly that.
 *
 * A real TanStack router on the BROWSER history (the app's history) carries the
 * header (`GitStatusBadge`) and the `/releases` screen, wired as `router.tsx`'s
 * `ReleasesIndexRoute` wires it (`tab`, `ref` from the search, `visit` = the
 * history entry's key). Only the network (`fetch`), the config, the entity
 * registry and the briefs/pushes lists are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useConfig.js', () => ({ useConfig: () => ({ data: { git: { enabled: true } } }) }));
vi.mock('../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));
vi.mock('../hooks/useReleasePushes.js', () => ({
  releasePushesKey: (releaseName: string | undefined) => ['release-pushes', { releaseName }],
  useAllReleasePushes: () => ({ data: [] }),
}));
vi.mock('../hooks/useBriefs.js', () => ({ useBriefs: () => ({ data: [] }) }));
vi.mock('./BriefsList.js', () => ({ ImplementedBadge: () => null }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: {
    listAvailable: () => [{ type: 'endpoint', label: 'Endpoint', labelPlural: 'Endpoints' }],
    getEntity: (type: string) => (type === 'endpoint' ? { pathPrefix: '/endpoints' } : undefined),
    getAvailable: () => undefined,
    listEntities: () => [],
  },
}));
vi.mock('../entities/HostCard.js', async () => {
  const React = await import('react');
  return {
    HostCard: ({ slug }: { slug: string }) => React.createElement('div', { 'data-host-card': slug }),
  };
});
const endpointDef = vi.hoisted(() => ({
  label: 'Endpoint',
  renderCard: () => null,
  useGetBySlug: (slug: string) => ({ data: { slug, title: `master ${slug}` }, isLoading: false }),
}));
vi.mock('../entities/registry.js', () => ({
  getEntityDef: (type: string) => (type === 'endpoint' ? endpointDef : null),
}));
vi.mock('../entities/index.js', () => ({
  getEntityDef: (type: string) => (type === 'endpoint' ? endpointDef : null),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHADOW = 'run-1/spec';
const OTHER = 'run-2/spec';

function shadowDiff(id: string, tipSha: string) {
  return {
    mode: 'merge',
    shadow: { id, tipSha },
    head: { sha: 'ccccccc3333333333333333333333333333333' },
    base: { sha: 'aaaaaaa1111111111111111111111111111111' },
    masterAhead: 0,
    conflicts: [],
    mergePreview: true,
    outsideSpecFiles: [],
    touchesReleases: false,
    commits: [{ sha: tipSha, subject: 'Spec run', body: '' }],
    entities: [{ type: 'endpoint', slug: `get-${id.slice(0, 5)}`, op: 'updated', changes: [] }],
    pages: [],
    before: {},
  };
}

const DIFFS: Record<string, unknown> = {
  [SHADOW]: shadowDiff(SHADOW, 'bbbbbbb2222222222222222222222222222222'),
  [OTHER]: shadowDiff(OTHER, 'ddddddd4444444444444444444444444444444'),
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url).replace(/^\/api\/projects\/[^/]+/, '/api'),
    method: ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
  }));

/**
 * One page load: every module evaluated afresh (nothing module-scoped carries
 * over from an earlier load), a browser history reading the window's current
 * URL and `history.state`, the header + `/releases` screen mounted.
 */
async function loadPage() {
  vi.resetModules();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const TR = await import('@tanstack/react-router');
  const { GitStatusBadge } = await import('./GitStatusBadge.js');
  const { RELEASES_TABS, ReleasesPage } = await import('./ReleasesPage.js');
  const { useGitOpsStore } = await import('../state/gitOps.js');
  const { act, createElement } = React;
  useGitOpsStore.setState({ pending: null });

  function ReleasesRoute() {
    const { tab, ref } = TR.useSearch({ strict: false }) as { tab?: (typeof RELEASES_TABS)[number]; ref?: string };
    const visit = TR.useLocation({ select: (l) => l.state.__TSR_key });
    return createElement(ReleasesPage, { tab, shadowRef: ref, visit });
  }
  const rootRoute = TR.createRootRoute({
    component: () => createElement('div', null, createElement(GitStatusBadge), createElement(TR.Outlet)),
  });
  const indexRoute = TR.createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const releasesRoute = TR.createRoute({
    getParentRoute: () => rootRoute,
    path: '/releases',
    validateSearch: (search: Record<string, unknown>) => ({
      tab: RELEASES_TABS.find((t) => t === search.tab),
      ref: typeof search.ref === 'string' && search.ref ? search.ref : undefined,
    }),
    component: ReleasesRoute,
  });
  const router = TR.createRouter({
    routeTree: rootRoute.addChildren([indexRoute, releasesRoute]),
    history: TR.createBrowserHistory(),
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  async function flush() {
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(TR.RouterProvider, { router } as never)));
  });
  await flush();

  const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panel = (id: string) => host.querySelector<HTMLElement>(`[role="tabpanel"][data-tab-panel="${id}"]`);
  const picker = () => host.querySelector<HTMLSelectElement>('[data-shadow-picker]');

  return {
    router,
    tabs,
    panel,
    picker,
    shownShadow: () => host.querySelector<HTMLElement>('[data-shadow-header]')?.textContent ?? '',
    async clickHeaderShadow(id: string) {
      const toggle = host.querySelector<HTMLElement>('[data-git-entry-toggle]');
      expect(toggle).not.toBeNull();
      await act(async () => {
        toggle!.click();
      });
      await flush();
      const item = document.body.querySelector<HTMLButtonElement>(`[data-git-shadows] [data-git-shadow="${id}"]`);
      expect(item).not.toBeNull();
      await act(async () => {
        item!.click();
      });
      await flush();
    },
    async clickTab(index: number) {
      await act(async () => {
        tabs()[index]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    },
    async pick(id: string) {
      await act(async () => {
        const p = picker()!;
        p.value = id;
        p.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();
    },
    async refetchStatus() {
      await act(async () => {
        await qc.refetchQueries({ queryKey: ['git-status'] });
      });
      await flush();
      return qc.getQueryData<{ branch: string }>(['git-status'])?.branch;
    },
    /** Leaves the page: the window and its history stay, this load's modules and state go. */
    unload() {
      act(() => root.unmount());
      host.remove();
      qc.clear();
      router.history.destroy();
    },
  };
}

type Page = Awaited<ReturnType<typeof loadPage>>;
let page: Page | null = null;

function expectShadowOpen(p: Page, id: string) {
  expect(p.router.state.location.pathname).toBe('/releases');
  expect(p.router.state.location.search).toEqual({ tab: 'shadow', ref: SHADOW });
  expect(p.tabs()[2]!.getAttribute('aria-selected')).toBe('true');
  expect(p.panel('shadow')!.hidden).toBe(false);
  expect(p.panel('list')!.hidden).toBe(true);
  expect(p.picker()!.value).toBe(id);
  expect(p.shownShadow()).toContain(id);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  fetchMock = vi.fn(async (url: string) => {
    const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
    if (path === '/api/releases') return json({ releases: [] });
    if (path === '/api/git/status') {
      return json({ detected: true, rootPath: '/repo', remoteUrl: null, branch: 'main', isDirty: false, ahead: null, behind: null, lastFetchedAt: null });
    }
    if (path === '/api/git/branches') return json({ current: 'main', branches: ['main', 'feature'] });
    if (path === '/api/git/shadows') {
      return json({
        shadows: [
          { id: SHADOW, tipSha: 'bbbbbbb2222222222222222222222222222222', tipCommittedAt: '2026-10-23T10:00:00.000Z', tipSubject: 'Spec run' },
          { id: OTHER, tipSha: 'ddddddd4444444444444444444444444444444', tipCommittedAt: '2026-10-22T10:00:00.000Z', tipSubject: 'Other run' },
        ],
      });
    }
    const m = path.match(/^\/api\/shadow-diff\?ref=(.*)$/);
    if (m) {
      const body = DIFFS[decodeURIComponent(m[1]!)];
      return body ? json(body) : json({ error: { code: 'SHADOW_NOT_FOUND', message: 'Shadow not found' } }, 404);
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  page?.unload();
  page = null;
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('header Shadows section → /releases Shadows tab across a page reload (goal u5-shadows-ui)', () => {
  it('[goal:u5-shadows-ui] [ac:ac-klik-pozycji-w-sekcji-shadows-nie-zmi] [section:846dmtbu] after a reload, a click on the same header shadow — after a tab switch and after another pick — opens that shadow on the Shadows tab, navigating only', async () => {
    page = await loadPage();
    expect(page.router.state.location.pathname).toBe('/');

    // Before the reload: a click lands on the Shadows tab with that shadow.
    await page.clickHeaderShadow(SHADOW);
    expectShadowOpen(page, SHADOW);
    const href = page.router.state.location.href;
    // The per-click token is in the browser's history entry — what a reload keeps.
    expect(window.history.state?.shadowVisit).toBe(1);

    // Reload: same URL, same history entry, every module evaluated afresh.
    page.unload();
    page = await loadPage();
    expect(page.router.state.location.href).toBe(href);
    expectShadowOpen(page, SHADOW);
    const reloadedVisit = page.router.state.location.state.__TSR_key;

    // A switch to the Releases tab is screen state: the URL stays as it is.
    await page.clickTab(0);
    expect(page.panel('list')!.hidden).toBe(false);
    expect(page.panel('shadow')!.hidden).toBe(true);
    expect(page.router.state.location.href).toBe(href);

    // The same header shadow again, onto the very same URL, first click after the reload
    // → a new history entry and the Shadows tab again (a restarted per-load counter would
    // reproduce the current entry's state and the router would drop the click).
    await page.clickHeaderShadow(SHADOW);
    expect(page.router.state.location.href).toBe(href);
    expect(page.router.state.location.state.__TSR_key).not.toBe(reloadedVisit);
    expect(window.history.state?.shadowVisit).toBe(2);
    expectShadowOpen(page, SHADOW);

    // Another pick in the picker (screen state), then the same header shadow → that shadow.
    await page.pick(OTHER);
    expect(page.picker()!.value).toBe(OTHER);
    expect(page.router.state.location.href).toBe(href);
    await page.clickHeaderShadow(SHADOW);
    expect(window.history.state?.shadowVisit).toBe(3);
    expectShadowOpen(page, SHADOW);

    // Navigation only: every request was a read, no checkout, HEAD (`branch`) unchanged.
    expect(requests().every((r) => r.method === 'GET')).toBe(true);
    expect(requests().some((r) => r.path === '/api/git/checkout')).toBe(false);
    expect(await page.refetchStatus()).toBe('main');
  });
});
