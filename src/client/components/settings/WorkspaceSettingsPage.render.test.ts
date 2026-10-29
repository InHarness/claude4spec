// @vitest-environment happy-dom
/**
 * 2.1.58 — the workspace settings page (M26 `m26route` / `7f76eszm` /
 * `oqp0up79`, ui-view `workspace-settings-page`; M50 `6tn2yf92`, M33
 * `jz4lgiy7`).
 *
 * The router and the shell are the REAL ones: `router.tsx`'s base routes as a
 * document WITHOUT an injected project mounts them, under the real
 * `RootLayout`, driven by a memory history. `fetch` is stubbed to answer the
 * two workspace-scope reads and to record every request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';

import { BASE_ROUTE_CHILDREN, rootRoute, routesForDocument } from '../../router.js';
import { PROJECT_ID } from '../../lib/api-core.js';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let requests: string[];

const workspace = {
  name: 'team-ws',
  kind: 'home',
  lastOpenedProject: 'alpha',
  mode: 'prod',
  defaultPort: 4500,
  projects: [{ id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true }],
};

/** `GET /api/_meta/plugins` — the process-level base diagnostics. */
const basePool = {
  hostApiVersion: HOST_API_VERSION,
  packages: [
    { package: '@acme/adr', status: 'loaded', layer: 'base', contributedTypes: ['adr'] },
    {
      package: '@acme/missing',
      status: 'skipped',
      code: 'PLUGIN_NOT_INSTALLED',
      reason: 'not installed in /home/u/ws/node_modules',
      layer: 'base',
    },
  ],
};

/** 2.1.62 (M54): the list read of the Runner hosts card — workspace scope, no project prefix. */
const RUNNER_HOSTS_URL = '/api/workspace/runner-hosts?limit=200';

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

const cardAnchors = () => [...host.querySelectorAll('section[id]')].map((s) => s.id);

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      if (String(url) === '/api/workspace') return new Response(JSON.stringify(workspace), { status: 200 });
      if (String(url) === '/api/_meta/plugins') return new Response(JSON.stringify(basePool), { status: 200 });
      if (String(url) === RUNNER_HOSTS_URL) return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: String(url) } }), { status: 404 });
    }),
  );
  vi.stubGlobal(
    'WebSocket',
    class {
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
  window.location.hash = '';
});

describe('ui-view workspace-settings-page', () => {
  it('[entity:workspace-settings-page] /workspace/settings is a workspace route at its url: mounted by a document without a project, never under the project prefix; the #<card anchor> hash scrolls smoothly to that card', async () => {
    const route = BASE_ROUTE_CHILDREN.find((r) => pathOf(r) === '/workspace/settings');
    expect(route).toBeDefined();
    expect(route!.options.staticData).toEqual({ routeKind: 'workspace' });
    expect(routesForDocument(BASE_ROUTE_CHILDREN, '').map(pathOf)).toContain('/workspace/settings');
    expect(routesForDocument(BASE_ROUTE_CHILDREN, 'alpha').map(pathOf)).not.toContain('/workspace/settings');

    // The hash parameter: `#plugin-pool` lands on the Plugin pool card.
    const scrolled: Array<{ id: string; opts: unknown }> = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, opts?: unknown) {
      scrolled.push({ id: this.id, opts });
    } as typeof HTMLElement.prototype.scrollIntoView;
    try {
      window.location.hash = '#plugin-pool';
      await openWorkspaceDocument('/workspace/settings');
      expect(scrolled).toContainEqual({ id: 'plugin-pool', opts: { behavior: 'smooth', block: 'start' } });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('[ac:ac-strona-ustawien-workspace-u-workspace] the workspace settings page (/workspace/settings) opens without a selected project', async () => {
    // No project in this document: no injected global, no project id.
    expect((window as { __C4S_PROJECT__?: unknown }).__C4S_PROJECT__).toBeUndefined();
    expect(PROJECT_ID).toBe('');

    const router = await openWorkspaceDocument('/workspace/settings');
    // It opens — no redirect to a project, no error state, in the workspace frame.
    expect(router.state.location.pathname).toBe('/workspace/settings');
    expect(host.querySelector('[data-testid="workspace-frame"]')).not.toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('Workspace settings');
    expect(host.querySelector('[data-testid="workspace-settings-name"]')?.textContent).toBe('team-ws');
    expect(cardAnchors()).toEqual(['appearance', 'runner-hosts', 'plugin-pool']);
    expect(host.textContent).not.toContain('Could not load this project');
    // It asks only the workspace-scope reads — nothing under a project prefix, no project config.
    expect(new Set(requests)).toEqual(new Set(['/api/workspace', '/api/_meta/plugins', RUNNER_HOSTS_URL]));
    expect(requests.some((u) => u.startsWith('/api/projects/') || u === '/api/config')).toBe(false);
  });

  it('[section:7f76eszm] [section:m26route] only the cards of scope workspace render here — no project card', async () => {
    await openWorkspaceDocument('/workspace/settings');
    const anchors = cardAnchors();
    expect(anchors).toEqual(['appearance', 'runner-hosts', 'plugin-pool']);
    for (const projectCard of ['user-section', 'project', 'git', 'directories', 'entities', 'agent', 'skills', 'about', 'danger-zone']) {
      expect(anchors, projectCard).not.toContain(projectCard);
    }
  });

  it('[section:oqp0up79] the workspace settings page has no [Save] at all', async () => {
    await openWorkspaceDocument('/workspace/settings');
    expect(cardAnchors().length).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid^="settings-save-"]')).toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => /save/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('[section:m26asec] the Appearance card stands here and changes the global theme at once, with no route call', async () => {
    await openWorkspaceDocument('/workspace/settings');
    const card = host.querySelector('#appearance')!;
    const dark = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Dark'))!;
    expect(dark).toBeDefined();
    const before = requests.length;
    await act(async () => {
      dark.click();
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(requests.length).toBe(before);
    const light = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Light'))!;
    await act(async () => {
      light.click();
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('[section:jz4lgiy7] the Plugin pool card reads the base from the process-level GET /api/_meta/plugins: one row per base package with its state and reason, no project overlay', async () => {
    await openWorkspaceDocument('/workspace/settings');
    const card = host.querySelector('#plugin-pool')!;
    const rows = [...card.querySelectorAll('[data-testid="plugin-pool-package"]')];
    expect(rows.map((r) => r.getAttribute('data-package'))).toEqual(['@acme/adr', '@acme/missing']);
    expect(rows[0]!.textContent).toContain('loaded');
    expect(rows[0]!.textContent).toContain('adr');
    expect(rows[1]!.textContent).toContain('skipped');
    expect(rows[1]!.textContent).toContain('not installed in /home/u/ws/node_modules');
    expect(card.textContent).toContain(`Host API ${HOST_API_VERSION}`);
    // No overlay report: no layer pill on a row, no trust state, no shadowing.
    for (const row of rows) expect(row.textContent).not.toMatch(/\bbase\b|overlay|trusted/i);
    expect(card.textContent).not.toMatch(/shadow|project plugins/i);
    expect(requests).toContain('/api/_meta/plugins');
  });
});
