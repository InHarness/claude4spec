// @vitest-environment happy-dom
/**
 * 2.1.58 — the workspace route frame (M50 `1bd92aq2`, M31 `eb95ery1`, M50
 * `k4fhsrkz` / `l5stlocs` / `6z6uzzhv`, ui-view `welcome-page`).
 *
 * The router and the shell are the REAL ones: `router.tsx`'s base routes, as a
 * document without an injected project mounts them, under the real
 * `RootLayout`, driven by a memory history. The project-shell regions are
 * replaced by spies only so the test can see they never render; `fetch` and
 * `WebSocket` are stubbed to watch what the frame asks the server for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';

const spies = vi.hoisted(() => ({
  sidebar: vi.fn(() => null),
  chatOverlay: vi.fn(() => null),
  chatHandle: vi.fn(() => null),
  staleBar: vi.fn(() => null),
  fileWatcher: vi.fn(),
}));

vi.mock('./components/Sidebar.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components/Sidebar.js')>()),
  Sidebar: spies.sidebar,
}));
vi.mock('./chat/ChatOverlay.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chat/ChatOverlay.js')>()),
  ChatOverlay: spies.chatOverlay,
}));
vi.mock('./components/ChatEdgeAffordance.js', () => ({ ChatEdgeAffordance: spies.chatHandle }));
vi.mock('./components/IndexStaleBanner.js', () => ({ IndexStaleBanner: spies.staleBar }));
vi.mock('./hooks/useFileWatcher.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./hooks/useFileWatcher.js')>()),
  useFileWatcher: spies.fileWatcher,
}));

import { BASE_ROUTE_CHILDREN, rootRoute, routesForDocument } from './router.js';
import { PROJECT_ID } from './lib/api-core.js';
import { PROJECT_SCOPE } from './state/persisted.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let requests: string[];
let sockets: number;

const workspace = {
  name: 'team-ws',
  kind: 'home',
  lastOpenedProject: 'alpha',
  mode: 'prod',
  defaultPort: 4500,
  projects: [
    { id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true },
    { id: 'beta', name: 'Beta', cwd: '/work/beta', live: false },
  ],
};

const pathOf = (route: unknown): string | undefined => (route as { options?: { path?: string } }).options?.path;

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** A document without `window.__C4S_PROJECT__`, opened at `path`. */
async function openWorkspaceDocument(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: rootRoute.addChildren(routesForDocument(BASE_ROUTE_CHILDREN, PROJECT_ID)),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  await act(async () => {
    await router.load();
  });
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(RouterProvider, { router } as never)),
    );
  });
  await flush();
  return router;
}

beforeEach(() => {
  requests = [];
  sockets = 0;
  for (const spy of Object.values(spies)) spy.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      if (String(url) === '/api/workspace') return new Response(JSON.stringify(workspace), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: String(url) } }), { status: 404 });
    }),
  );
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor() {
        sockets += 1;
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('workspace routes are mounted outside the project prefix (M31 eb95ery1)', () => {
  it('[entity:welcome-page] /welcome declares itself a workspace route at its url, without params', () => {
    const welcome = BASE_ROUTE_CHILDREN.find((r) => pathOf(r) === '/welcome');
    expect(welcome).toBeDefined();
    expect(welcome!.options.staticData).toEqual({ routeKind: 'workspace' });
    // Not a full-screen project route any more: its frame is the workspace one.
    expect(welcome!.options.staticData?.fullscreen).toBeUndefined();
  });

  it('[section:eb95ery1] a document without a project mounts the workspace routes at the root and no project route; a project document mounts the project routes and no workspace route', () => {
    expect(routesForDocument(BASE_ROUTE_CHILDREN, '').map(pathOf)).toEqual(['/welcome']);

    const projectPaths = routesForDocument(BASE_ROUTE_CHILDREN, 'alpha').map(pathOf);
    expect(projectPaths).not.toContain('/welcome');
    expect(projectPaths).toEqual(expect.arrayContaining(['/', '/space/$rootId/$', '/settings', '/onboarding']));
    // Every base route is mounted by exactly one of the two documents.
    expect(projectPaths.length + 1).toBe(BASE_ROUTE_CHILDREN.length);
  });
});

describe('the workspace route frame (M50 1bd92aq2)', () => {
  it('[section:1bd92aq2] [entity:welcome-page] /welcome renders in the workspace frame: one bar with the branding and the Nagłówek entries above the outlet; no project sidebar, chat overlay, chat handle or staleness bar', async () => {
    const router = await openWorkspaceDocument('/welcome');
    expect(router.state.location.pathname).toBe('/welcome');

    const frame = host.querySelector('[data-testid="workspace-frame"]');
    expect(frame).not.toBeNull();
    const bar = frame!.querySelector('[data-testid="workspace-frame-bar"]');
    expect(bar).not.toBeNull();
    // The bar: application branding (shell element) + the workspace route's header entry (M31).
    expect(bar!.querySelector('a[href="https://claude4spec.inharness.ai"] svg')).not.toBeNull();
    const entry = bar!.querySelector('[data-testid="workspace-header-entry"]');
    expect(entry?.textContent).toContain('team-ws');
    expect(entry?.querySelector('a')?.getAttribute('href')).toBe('/p/alpha/');
    // The outlet below the bar holds the Welcome screen.
    expect(bar!.nextElementSibling?.textContent).toContain('Welcome to claude4spec');
    expect(bar!.textContent).not.toContain('Welcome to claude4spec');

    // Nothing that assumes a project or its projection.
    expect(spies.sidebar).not.toHaveBeenCalled();
    expect(host.querySelector('aside')).toBeNull();
    expect(spies.chatOverlay).not.toHaveBeenCalled();
    expect(spies.chatHandle).not.toHaveBeenCalled();
    expect(spies.staleBar).not.toHaveBeenCalled();
  });

  it('[section:1bd92aq2] the frame does not connect to the event channel and asks only the workspace-scope read, once for every reader on the page', async () => {
    await openWorkspaceDocument('/welcome');

    expect(spies.fileWatcher).not.toHaveBeenCalled();
    expect(sockets).toBe(0);
    // The header entry and the Welcome screen share ONE `GET /api/workspace`;
    // no project-scoped call (`/api/config`, `/api/_meta/…`) is made.
    expect(requests).toEqual(['/api/workspace']);
  });
});

describe('the document of a workspace route has no project (M50 k4fhsrkz, l5stlocs, 6z6uzzhv)', () => {
  it('[section:l5stlocs] [section:6z6uzzhv] on a workspace route the missing project global is the ordinary path: the key scope is `default`, the API has no project prefix, the router mounts at the root', async () => {
    expect((window as { __C4S_PROJECT__?: unknown }).__C4S_PROJECT__).toBeUndefined();
    expect(PROJECT_ID).toBe('');
    expect(PROJECT_SCOPE).toBe('default');

    const router = await openWorkspaceDocument('/welcome');
    // The workspace route renders normally — no error state, no redirect.
    expect(router.state.location.pathname).toBe('/welcome');
    expect(host.textContent).toContain('Welcome to claude4spec');
    expect(host.textContent).not.toContain('Could not load this project');
    // The last opened project comes from the workspace registry read, not from local storage.
    expect(host.querySelector('[data-testid="workspace-header-entry"] a')?.getAttribute('href')).toBe('/p/alpha/');
    expect(requests).toEqual(['/api/workspace']);
  });
});
