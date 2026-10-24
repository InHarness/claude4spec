// @vitest-environment happy-dom
/**
 * 2.1.46 (M28 846dmtbu, review rev-0001) — a click on a shadow item in the
 * header's Shadows section always opens THAT shadow on the Shadows tab, also
 * when the URL already is `/releases?tab=shadow&ref=<id>`: after a switch to
 * another tab (screen state, the URL untouched) and after another pick in the
 * picker. The click stays navigation-only — no checkout, HEAD untouched.
 *
 * A real TanStack router (memory history) carries the header (`GitStatusBadge`)
 * and the `/releases` screen, wired as `router.tsx`'s `ReleasesIndexRoute`
 * wires it (`tab`, `ref` from the search, `visit` = the history entry's key).
 * Only the network (`fetch`), the config, the entity registry and the
 * briefs/pushes lists are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
  useSearch,
} from '@tanstack/react-router';

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

import { GitStatusBadge } from './GitStatusBadge.js';
import { RELEASES_TABS, ReleasesPage, type ReleasesTab } from './ReleasesPage.js';
import { useGitOpsStore } from '../state/gitOps.js';

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

let fetchMock: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url).replace(/^\/api\/projects\/[^/]+/, '/api'),
    method: ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
  }));

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The `/releases` route component as `router.tsx` wires it. */
function ReleasesRoute(): ReactElement {
  const { tab, ref } = useSearch({ strict: false }) as { tab?: ReleasesTab; ref?: string };
  const visit = useLocation({ select: (l) => l.state.__TSR_key });
  return createElement(ReleasesPage, { tab, shadowRef: ref, visit });
}

function makeRouter() {
  const rootRoute = createRootRoute({
    component: () => createElement('div', null, createElement(GitStatusBadge), createElement(Outlet)),
  });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const releasesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/releases',
    validateSearch: (search: Record<string, unknown>) => ({
      tab: RELEASES_TABS.find((t) => t === search.tab),
      ref: typeof search.ref === 'string' && search.ref ? search.ref : undefined,
    }),
    component: ReleasesRoute,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, releasesRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

let router: ReturnType<typeof makeRouter>;

const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const panel = (id: string) => host.querySelector<HTMLElement>(`[role="tabpanel"][data-tab-panel="${id}"]`);
const picker = () => host.querySelector<HTMLSelectElement>('[data-shadow-picker]');
const shownShadow = () => host.querySelector<HTMLElement>('[data-shadow-header]')?.textContent ?? '';

async function clickHeaderShadow(id: string) {
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
}

function expectShadowOpen(id: string) {
  expect(router.state.location.pathname).toBe('/releases');
  expect(router.state.location.search).toEqual({ tab: 'shadow', ref: SHADOW });
  expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
  expect(panel('shadow')!.hidden).toBe(false);
  expect(panel('list')!.hidden).toBe(true);
  expect(picker()!.value).toBe(id);
  expect(shownShadow()).toContain(id);
}

beforeEach(() => {
  useGitOpsStore.setState({ ops: [] });
  window.sessionStorage.clear();
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
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  router = makeRouter();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  qc.clear();
  vi.unstubAllGlobals();
});

describe('header Shadows section → /releases Shadows tab, repeated clicks (rev-0001)', () => {
  it('[review:rev-0001] [ac:ac-klik-pozycji-w-sekcji-shadows-nie-zmi] [section:846dmtbu] a click on the same header shadow again — after a tab switch and after another pick — opens that shadow on the Shadows tab, navigating only (no checkout, HEAD untouched)', async () => {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(RouterProvider, { router } as never)));
    });
    await flush();
    expect(router.state.location.pathname).toBe('/');

    // First click: lands on the Shadows tab with that shadow.
    await clickHeaderShadow(SHADOW);
    expectShadowOpen(SHADOW);
    const href = router.state.location.href;
    const firstVisit = router.state.location.state.__TSR_key;

    // A switch to the Releases tab is screen state: the URL stays as it is.
    await act(async () => {
      tabs()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(panel('list')!.hidden).toBe(false);
    expect(panel('shadow')!.hidden).toBe(true);
    expect(router.state.location.href).toBe(href);

    // The same header shadow again, onto the very same URL → the Shadows tab again.
    await clickHeaderShadow(SHADOW);
    expect(router.state.location.href).toBe(href);
    expect(router.state.location.state.__TSR_key).not.toBe(firstVisit);
    expectShadowOpen(SHADOW);

    // Another pick in the picker (screen state, the URL untouched)…
    await act(async () => {
      const p = picker()!;
      p.value = OTHER;
      p.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(picker()!.value).toBe(OTHER);
    expect(shownShadow()).toContain(OTHER);
    expect(router.state.location.href).toBe(href);

    // …and the same header shadow again → that shadow, not the pick.
    await clickHeaderShadow(SHADOW);
    expect(router.state.location.href).toBe(href);
    expectShadowOpen(SHADOW);

    // Navigation only: every request was a read, no checkout, HEAD (`branch`) unchanged.
    expect(requests().every((r) => r.method === 'GET')).toBe(true);
    expect(requests().some((r) => r.path === '/api/git/checkout')).toBe(false);
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['git-status'] });
    });
    await flush();
    expect(qc.getQueryData<{ branch: string }>(['git-status'])?.branch).toBe('main');
  });
});

describe('every visit applies its own `tab` / `ref` — a visit without `tab` lands on the list', () => {
  it('[entity:releases-list] browser Back from `/releases?tab=shadow&ref=<id>` to a plain `/releases` lands on the Releases tab; Forward lands on that shadow again', async () => {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(RouterProvider, { router } as never)));
    });
    await flush();

    // A plain `/releases` visit: the list.
    await act(async () => {
      router.history.push('/releases');
    });
    await flush();
    expect(router.state.location.search).toEqual({});
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(panel('list')!.hidden).toBe(false);

    // The header's shadow → a new entry `?tab=shadow&ref=<id>`, the Shadows tab.
    await clickHeaderShadow(SHADOW);
    expectShadowOpen(SHADOW);

    // Back: the entry without `tab` — the list, the Shadows body only hidden.
    await act(async () => {
      router.history.back();
    });
    await flush();
    expect(router.state.location.pathname).toBe('/releases');
    expect(router.state.location.search).toEqual({});
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('false');
    expect(panel('list')!.hidden).toBe(false);
    expect(panel('shadow')!.hidden).toBe(true);

    // Forward: the shadow's entry again — the Shadows tab with that shadow.
    await act(async () => {
      router.history.forward();
    });
    await flush();
    expectShadowOpen(SHADOW);

    // Another pick stays screen state (the URL untouched); Back from there still lands on the list.
    await act(async () => {
      const p = picker()!;
      p.value = OTHER;
      p.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(shownShadow()).toContain(OTHER);
    await act(async () => {
      router.history.back();
    });
    await flush();
    expect(router.state.location.search).toEqual({});
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(panel('list')!.hidden).toBe(false);
    expect(panel('shadow')!.hidden).toBe(true);

    // Navigation only: reads, no checkout.
    expect(requests().every((r) => r.method === 'GET')).toBe(true);
    expect(requests().some((r) => r.path === '/api/git/checkout')).toBe(false);
  });
});
