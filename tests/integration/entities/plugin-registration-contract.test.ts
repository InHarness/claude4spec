/**
 * 2.1.57 — the M13 plugin registration contract, checked on the REAL type
 * declarations (every built-in envelope built from source in this repo; since
 * 2.1.63 `diagram` ships prebuilt and its declaration is the `diagrams`
 * project's), not on fixtures:
 *
 *   - `x2nr826t` — the slug-collision policy is declared per type on the
 *     identity (`slugCollision?: 'error' | 'suffix'`, omitted = `'error'`), and
 *     every type whose derived slug suffixes on collision declares `'suffix'`
 *     in the same round — so the host default refuses for everybody else;
 *   - `l4crudhl` — there is no generic CRUD route helper: the host generates
 *     CRUD REST, a plugin's `backend.routes` router carries domain routes only,
 *     and a type without domain routes declares no router;
 *   - `m13pool0` — the silent last-wins of the BASE registry stays; nothing
 *     changes in code.
 *
 * Lives under `tests/` because it imports the envelopes' own sources next to
 * the host's, which no single envelope config compiles together (the pattern of
 * `display-order-retired.test.ts`).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { lowerEntityContribution } from '../../../src/server/core/plugin-host/manifest-adapter.js';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import type { BackendModule, MountContext } from '../../../src/server/core/plugin-host/types.js';
import type { EntityContribution } from '../../../src/shared/plugin-host/manifest.js';
import { fixtureModule } from '../../helpers/fixture-module.js';
import { manifest as acManifest } from '../../../plugins/c4s-plugin-ac/src/manifest.js';
import { manifest as apiContractsManifest } from '../../../plugins/c4s-plugin-api-contracts/src/manifest.js';
import { manifest as codeSnippetsManifest } from '../../../plugins/c4s-plugin-code-snippets/src/manifest.js';
import { manifest as databaseTablesManifest } from '../../../plugins/c4s-plugin-database-tables/src/manifest.js';
import { manifest as frontendMockupsManifest } from '../../../plugins/c4s-plugin-frontend-mockups/src/manifest.js';
import { manifest as uiKitManifest } from '../../../plugins/c4s-plugin-host-ui-kit-components/src/manifest.js';
import { manifest as lvsManifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';
import { manifest as spreadsheetsManifest } from '../../../plugins/c4s-plugin-spreadsheets/src/manifest.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

type Manifest = { contributes?: { entities?: unknown[] } };

const MANIFESTS: Manifest[] = [
  acManifest,
  apiContractsManifest,
  codeSnippetsManifest,
  databaseTablesManifest,
  frontendMockupsManifest,
  uiKitManifest,
  lvsManifest,
  spreadsheetsManifest,
] as Manifest[];

const CONTRIBUTIONS: EntityContribution[] = MANIFESTS.flatMap(
  (m) => (m.contributes?.entities ?? []) as EntityContribution[],
);

/** Every type package's entity directories — discovered, so a new type cannot slip past the table below. */
function discoveredPluginTypes(): string[] {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(PLUGINS_DIR, e.name, 'src', 'entity'))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name))
    .sort();
}

/**
 * The policy each type declares. `'suffix'` is the answer of a type for which
 * two records with the same title are ordinary; every other type refuses
 * (declared `'error'` or omitted).
 */
const SUFFIXING_TYPES = ['ac', 'code-snippet', 'module-dependency', 'spreadsheet', 'ui-kit-component'];

describe('[section:x2nr826t] slug collision — every type declares its policy on the identity', () => {
  it('the imported envelopes cover every type package in the repo', () => {
    expect(CONTRIBUTIONS.map((c) => c.type).sort()).toEqual(discoveredPluginTypes());
  });

  it("the suffixing types declare slugCollision: 'suffix'; every other type refuses ('error' or omitted)", () => {
    const modules: Array<{ type: string; slugCollision?: string }> = CONTRIBUTIONS.map((c) =>
      lowerEntityContribution(c),
    );
    for (const m of modules) {
      const effective = m.slugCollision ?? 'error';
      expect(effective, m.type).toBe(SUFFIXING_TYPES.includes(m.type) ? 'suffix' : 'error');
    }
    expect(modules.filter((m) => m.slugCollision === 'suffix').map((m) => m.type).sort()).toEqual(SUFFIXING_TYPES);
  });

  it('no declaration still carries the retired slugConflict key', () => {
    for (const c of CONTRIBUTIONS) {
      expect('slugConflict' in (c as unknown as Record<string, unknown>), c.type).toBe(false);
    }
  });
});

/** The routes the host generates for every type — a plugin router must not spell any of them. */
const GENERATED_ROUTE_PATHS = new Set(['/', '/:slug', '/restore', '/:slug/restore']);

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function routerOf(c: EntityContribution): { stack: RouteLayer[] } | null {
  const routes = (c.backend as { routes?: unknown } | undefined)?.routes as
    | { router?: unknown; prefix?: unknown }
    | undefined;
  if (routes == null) return null;
  // The prefix is inherited from the identity's `pathPrefix`; the router declares none.
  expect('prefix' in routes, `${c.type} routes.prefix`).toBe(false);
  const factory = routes.router;
  const router =
    typeof factory === 'function'
      ? (factory as (s: unknown, ctx: MountContext) => unknown)(undefined, {} as MountContext)
      : factory;
  return router as { stack: RouteLayer[] };
}

describe('[section:l4crudhl] no generic CRUD route helper — a plugin router carries domain routes only', () => {
  it('createCrudRouter exists nowhere in the host or the type packages', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (/\bcreateCrudRouter\b/.test(readFileSync(full, 'utf8'))) hits.push(relative(REPO_ROOT, full));
        }
      }
    };
    walk(join(REPO_ROOT, 'src'));
    walk(PLUGINS_DIR);
    expect(hits).toEqual([]);
  });

  it('every declared router has at least one route, and none of them is a generated CRUD route', () => {
    const withRouter: string[] = [];
    for (const c of CONTRIBUTIONS) {
      const router = routerOf(c);
      if (!router) continue;
      withRouter.push(c.type);
      const routes = router.stack.filter((l) => l.route).map((l) => l.route!);
      // A type without domain routes declares no router at all.
      expect(routes.length, `${c.type} declares an empty router`).toBeGreaterThan(0);
      for (const r of routes) {
        expect(GENERATED_ROUTE_PATHS.has(r.path), `${c.type} router spells ${r.path}`).toBe(false);
      }
    }
    // Sanity: the scan reached the two types that do carry domain routes.
    expect(withRouter.sort()).toEqual(['endpoint', 'ui-view']);
  });

  it("endpoint's router is exactly its two domain routes over linkedDtos", () => {
    const endpoint = CONTRIBUTIONS.find((c) => c.type === 'endpoint')!;
    const routes = routerOf(endpoint)!
      .stack.filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods).join(',').toUpperCase()} ${l.route!.path}`)
      .sort();
    expect(routes).toEqual(['DELETE /:slug/dtos/:dtoSlug/:relation', 'POST /:slug/dtos']);
  });
});

describe('[section:m13pool0] base registry collision stays a silent last-wins', () => {
  it('registerEntityModule with a type already in the base replaces it without throwing', () => {
    const registry = new PluginRegistryImpl();
    const first: BackendModule = fixtureModule('glossary');
    const second: BackendModule = { ...fixtureModule('glossary'), label: 'Glossary (second)' };
    registry.registerEntityModule(first);
    expect(() => registry.registerEntityModule(second)).not.toThrow();
    expect(registry.getAvailable('glossary')?.label).toBe('Glossary (second)');
    expect(registry.listAvailable().filter((m) => m.type === 'glossary')).toHaveLength(1);
  });

});

/**
 * 2.1.57 (`c4s-plugin-api-contracts` endpoint L11 `69i6wnvo`) — the endpoint
 * contribution's hand-written router carries ONLY its domain routes over
 * `linkedDtos`; CRUD REST for `endpoint` is generated by the host from
 * `data.schema` under the identity's `pathPrefix` (M13 `m13api00`). The page's
 * `/restore` is not a route of this router: restoring a version is the host's
 * `POST /api/entities/:type/:slug/versions/:version/restore` (ASSUMPTION:dev-0008).
 */
describe('[section:69i6wnvo] endpoint — the router carries only domain routes, the host generates CRUD REST', () => {
  const endpoint = CONTRIBUTIONS.find((c) => c.type === 'endpoint')!;

  it('[section:69i6wnvo] the endpoint router declares no prefix and no CRUD verb — only the linkedDtos routes', () => {
    const router = routerOf(endpoint)!;
    const routes = router.stack.filter((l) => l.route).map((l) => l.route!);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      // Every route is under `/:slug/dtos` — a domain operation on one endpoint's links.
      expect(r.path, `endpoint router spells ${r.path}`).toMatch(/^\/:slug\/dtos(\/|$)/);
      expect(GENERATED_ROUTE_PATHS.has(r.path)).toBe(false);
    }
  });

  it('[section:69i6wnvo] the contribution declares no CRUD of its own — no service, no CRUD schemas — so CRUD REST comes from the host', () => {
    const backend = (endpoint.backend ?? {}) as Record<string, unknown>;
    expect(Object.keys(backend).sort()).toEqual(['mcpServer', 'routes']);
    expect(backend).not.toHaveProperty('crud');
    expect(backend).not.toHaveProperty('service');
    // The generated CRUD router is mounted under the identity's prefix.
    expect(endpoint.pathPrefix).toBe('/endpoints');
    expect(Object.keys(endpoint.data.schema).length).toBeGreaterThan(0);
  });
});
