// @vitest-environment happy-dom
/**
 * 2.1.22 (M33 `87z9w99s`) — a plugin frontend takes the project id for its
 * project-scoped calls from `window.__C4S_PROJECT__.id`, the one contract global
 * the host injects into the document — not from the frontend manifest, not from
 * the address of its own entry, not from an invented global.
 *
 * Every built-in envelope with a frontend builds its URLs through its own copy of
 * `frontend-kit/api-core.ts`; each copy is loaded here fresh, under a document
 * carrying the global, and its `apiFetch` is watched. The AC envelope's real
 * client (`acsApi.get`) is driven too, so the path from plugin code to the wire
 * is the one a plugin frontend takes.
 *
 * Modules are named through variables (as in `window-facades.render.test.ts`):
 * the client compile does not resolve the envelopes' own `@c4s/plugin-runtime`
 * paths, so they stay out of this file's static import graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Win = Window & { __C4S_PROJECT__?: { id: string }; __c4s_projectId?: string };
type Kit = { PROJECT_ID: string; apiFetch: (input: string, init?: RequestInit) => Promise<Response> };

const ENVELOPES_WITH_KIT = [
  'c4s-plugin-ac',
  'c4s-plugin-api-contracts',
  'c4s-plugin-code-snippets',
  'c4s-plugin-database-tables',
  'c4s-plugin-frontend-mockups',
  'c4s-plugin-host-ui-kit-components',
  'c4s-plugin-layered-vertical-slices',
  'c4s-plugin-spreadsheets',
];
const kitPath = (plugin: string) => `../../../plugins/${plugin}/src/frontend-kit/api-core.js`;
const AC_API = '../../../plugins/c4s-plugin-ac/src/entity/ac/frontend/api.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ data: { slug: 'ac-x', title: 'x' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete (window as Win).__C4S_PROJECT__;
  delete (window as Win).__c4s_projectId;
  vi.unstubAllGlobals();
});

describe('plugin frontend project id (M33 87z9w99s)', () => {
  it('[ac:ac-frontend-pluginu-czyta-project-id-z-wind] a plugin frontend takes the project id for project-scoped calls from window.__C4S_PROJECT__.id', async () => {
    for (const projectId of ['app-spec', 'env-runner']) {
      // The document as the host serves it for /p/<id>/, plus an invented
      // global that must not be read.
      (window as Win).__C4S_PROJECT__ = { id: projectId };
      (window as Win).__c4s_projectId = 'decoy-global';

      for (const plugin of ENVELOPES_WITH_KIT) {
        vi.resetModules();
        fetchMock.mockClear();
        const kit = (await import(/* @vite-ignore */ kitPath(plugin))) as Kit;

        expect(kit.PROJECT_ID, plugin).toBe(projectId);
        await kit.apiFetch('/api/widgets/w-1?x=1');
        expect(fetchMock.mock.calls.map((c) => String(c[0])), plugin).toEqual([
          `/api/projects/${projectId}/widgets/w-1?x=1`,
        ]);
      }

      // The AC envelope's own client, end to end.
      vi.resetModules();
      fetchMock.mockClear();
      const { acsApi } = (await import(/* @vite-ignore */ AC_API)) as {
        acsApi: { get: (slug: string) => Promise<unknown> };
      };
      await acsApi.get('ac-x');
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls).toEqual([`/api/projects/${projectId}/acs/ac-x`]);
      expect(urls.join(' ')).not.toContain('decoy-global');
    }
  });
});
