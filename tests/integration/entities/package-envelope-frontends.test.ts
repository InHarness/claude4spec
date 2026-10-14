// @vitest-environment happy-dom
/**
 * 2.1.20 (M13 `z7l89jhf`, L11 of every package envelope) — the frontend of a
 * type is NOT part of its `EntityContribution`. Each package page's "Plugin
 * manifest" block now says the same thing for its type(s):
 *
 *   - the contribution carries no `frontend` block (and so imports no icon or
 *     component — the `lucide-react` import left the `ac` and `mcp-tool` blocks);
 *   - a separate frontend module enters through the package's BROWSER entry
 *     (`exports['./frontend']` → `src/frontend.tsx`) via `registerFrontendModule`,
 *     shape `FrontendModule`, and fills the slots the page lists — the four
 *     required ones (`renderChip`, `renderCard`, `useGetBySlug`, `listByTags`)
 *     plus routes / sidebarTab / renderRow / detailPanel for a visible type, or
 *     renderRow / renderOverlay without routes, detail panel or sidebar entry
 *     for the hidden `module-dependency`;
 *   - no retired slot rides along (`stateSlice`, `sidebarTab.emptyState`).
 *
 * The entry is imported for real. `@c4s/plugin-runtime` is the backend barrel
 * under this config's alias, so `registerFrontendModule` is supplied here: it
 * records the module and hands it to the host's own registration door
 * (`clientPluginHost.registerFrontendModule`), which throws on a module the
 * slot rules reject — an entry that registers a malformed module fails to
 * import. The slash-create popover mounts are stubbed (their own tests cover
 * them); `createRoute` hands back its options so the route paths can be read.
 *
 * ASSUMPTION:dev-2004 — `editorExtensions` and `sidebarTab.order` of the five
 * visible types whose pages still list a module-borne slash command are not
 * asserted: the trigger is declared only by `contributes.commands`.
 *
 * Lives under `tests/` because it imports the envelopes' own sources, which no
 * envelope config compiles together.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const registered = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@c4s/plugin-runtime', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const { clientPluginHost } = await import('../../../src/client/core/plugin-host/host.js');
  return {
    ...original,
    // the browser leg's live host, for module code that reads it
    clientPluginHost,
    registerFrontendModule: (mod: Record<string, unknown>) => {
      // the host's door first: a module it rejects never counts as registered
      clientPluginHost.registerFrontendModule(mod as never);
      registered.push(mod);
    },
  };
});

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createRoute: (opts: unknown) => opts,
}));

vi.mock('../../../plugins/c4s-plugin-ac/src/entity/ac/frontend/slash-create.js', () => ({
  mountAcSlashCreate: () => undefined,
}));
vi.mock('../../../plugins/c4s-plugin-api-contracts/src/entity/dto/frontend/slash-create.js', () => ({
  mountDtoSlashCreate: () => undefined,
}));
vi.mock('../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/frontend/slash-create.js', () => ({
  mountEndpointSlashCreate: () => undefined,
}));
vi.mock('../../../plugins/c4s-plugin-database-tables/src/entity/database-table/frontend/slash-create.js', () => ({
  mountDatabaseTableSlashCreate: () => undefined,
}));
vi.mock('../../../plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/slash-create.js', () => ({
  mountDesignSystemSlashCreate: () => undefined,
}));
vi.mock('../../../plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/frontend/slash-create.js', () => ({
  mountUiViewSlashCreate: () => undefined,
}));

import { checkSlotShapes, isHiddenModule } from '../../../src/client/core/plugin-host/slot-rules.js';
import { clientPluginHost } from '../../../src/client/core/plugin-host/host.js';
import type { FrontendModule } from '../../../src/client/core/plugin-host/types.js';
import { manifest as acManifest } from '../../../plugins/c4s-plugin-ac/src/manifest.js';
import { manifest as apiContractsManifest } from '../../../plugins/c4s-plugin-api-contracts/src/manifest.js';
import { manifest as databaseTablesManifest } from '../../../plugins/c4s-plugin-database-tables/src/manifest.js';
import { manifest as frontendMockupsManifest } from '../../../plugins/c4s-plugin-frontend-mockups/src/manifest.js';
import { manifest as mcpToolsManifest } from '../../../plugins/c4s-plugin-mcp-tools/src/manifest.js';
import { manifest as lvsManifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';
import { acFrontendModule } from '../../../plugins/c4s-plugin-ac/src/entity/ac/frontend/module.js';
import { dtoFrontendModule } from '../../../plugins/c4s-plugin-api-contracts/src/entity/dto/frontend/module.js';
import { endpointFrontendModule } from '../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/frontend/module.js';
import { databaseTableFrontendModule } from '../../../plugins/c4s-plugin-database-tables/src/entity/database-table/frontend/module.js';
import { designSystemFrontendModule } from '../../../plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/module.js';
import { uiViewFrontendModule } from '../../../plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/frontend/module.js';
import { mcpToolFrontendModule } from '../../../plugins/c4s-plugin-mcp-tools/src/entity/mcp-tool/frontend/module.js';
import { moduleDependencyFrontendModule } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/frontend/module.js';

// Resolved with node:path from the module's own file path — under happy-dom the
// global `URL` is the window's, so `new URL(rel, import.meta.url)` is not a
// `file:` URL that `fileURLToPath` accepts (same pattern as tokens.render.test.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = (rel: string) => resolve(REPO_ROOT, rel);

/** Modules each package's browser entry registered, keyed by package dir. */
const byEntry = new Map<string, Array<Record<string, unknown>>>();

const ENTRIES: Record<string, () => Promise<unknown>> = {
  'c4s-plugin-ac': () => import('../../../plugins/c4s-plugin-ac/src/frontend.js'),
  'c4s-plugin-api-contracts': () => import('../../../plugins/c4s-plugin-api-contracts/src/frontend.js'),
  'c4s-plugin-database-tables': () => import('../../../plugins/c4s-plugin-database-tables/src/frontend.js'),
  'c4s-plugin-frontend-mockups': () => import('../../../plugins/c4s-plugin-frontend-mockups/src/frontend.js'),
  'c4s-plugin-mcp-tools': () => import('../../../plugins/c4s-plugin-mcp-tools/src/frontend.js'),
  'c4s-plugin-layered-vertical-slices': () =>
    import('../../../plugins/c4s-plugin-layered-vertical-slices/src/frontend.js'),
};

beforeAll(async () => {
  for (const [pkg, load] of Object.entries(ENTRIES)) {
    const before = registered.length;
    await load();
    byEntry.set(pkg, registered.slice(before));
  }
}, 60_000);

type Manifest = { contributes?: { entities?: Array<Record<string, unknown>> } };

function contributionOf(manifest: Manifest, type: string): Record<string, unknown> {
  const c = manifest.contributes?.entities?.find((e) => e.type === type);
  if (!c) throw new Error(`no contribution for ${type}`);
  return c;
}

/** Route paths a visible module's fragment declares (createRoute is the identity here). */
function routePaths(mod: Record<string, unknown>): string[] {
  const routes = mod.routes as (ctx: { rootRoute: unknown }) => Array<{ path: string }>;
  return routes({ rootRoute: {} }).map((r) => r.path);
}

/**
 * The contribution half: no `frontend` block, no render slot of any kind, and
 * the file that declares it imports no icon library or React.
 */
function expectContributionWithoutFrontend(
  manifest: Manifest,
  type: string,
  contributionFile: string,
): void {
  const c = contributionOf(manifest, type);
  expect('frontend' in c).toBe(false);
  for (const slot of [
    'routes',
    'sidebarTab',
    'renderChip',
    'renderCard',
    'renderRow',
    'renderOverlay',
    'detailPanel',
    'editorExtensions',
    'stateSlice',
  ]) {
    expect(slot in c, `contribution ${type} carries '${slot}'`).toBe(false);
  }
  const src = readFileSync(root(contributionFile), 'utf8');
  expect(src).not.toMatch(/from ['"]lucide-react['"]/);
  expect(src).not.toMatch(/from ['"]react['"]/);
}

/**
 * The frontend half: registered by the package's browser entry, accepted by
 * the host's slot rules, with the four required slots and no retired slot.
 */
function expectRegisteredByEntry(
  pkg: string,
  exported: unknown,
  type: string,
): Record<string, unknown> {
  const pkgJson = JSON.parse(readFileSync(root(`plugins/${pkg}/package.json`), 'utf8')) as {
    exports: Record<string, { import?: string }>;
  };
  expect(pkgJson.exports['./frontend']?.import).toBe('./dist/frontend.js');

  const mods = byEntry.get(pkg) ?? [];
  const mod = mods.find((m) => m.type === type);
  expect(mod, `${pkg} browser entry did not register ${type}`).toBeDefined();
  expect(mod).toBe(exported);
  expect(clientPluginHost.getAvailable(type)).toBe(mod);
  expect(checkSlotShapes(mod as unknown as FrontendModule)).toBeNull();
  for (const slot of ['renderChip', 'renderCard', 'useGetBySlug', 'listByTags']) {
    expect(typeof (mod as Record<string, unknown>)[slot], `${type}.${slot}`).toBe('function');
  }
  expect('stateSlice' in (mod as object)).toBe(false);
  const tab = (mod as Record<string, unknown>).sidebarTab as Record<string, unknown> | undefined;
  if (tab) expect('emptyState' in tab).toBe(false);
  return mod as Record<string, unknown>;
}

function expectVisible(mod: Record<string, unknown>, label: string, paths: string[]): void {
  expect(isHiddenModule(mod as unknown as FrontendModule)).toBe(false);
  expect(typeof mod.renderRow).toBe('function');
  expect(typeof mod.detailPanel).toBe('function');
  expect(mod.renderOverlay).toBeUndefined();
  const tab = mod.sidebarTab as { icon: unknown; label: string; order: number };
  expect(tab.label).toBe(label);
  expect(tab.icon).toBeTruthy();
  expect(typeof tab.order).toBe('number');
  expect(routePaths(mod)).toEqual(paths);
}

describe('package envelopes — frontend module outside the type contribution (2.1.20)', () => {
  it('[section:fsu38c8q] ac: no frontend block in acEntity; the browser entry registers acFrontendModule with routes /acs…, sidebarTab "Acceptance Criteria", chip/card/row, detailPanel, useGetBySlug, listByTags', () => {
    expectContributionWithoutFrontend(acManifest, 'ac', 'plugins/c4s-plugin-ac/src/entity/ac/index.ts');
    const mod = expectRegisteredByEntry('c4s-plugin-ac', acFrontendModule, 'ac');
    expectVisible(mod, 'Acceptance Criteria', ['/acs', '/acs/$slug', '/acs/$slug/history']);
  });

  it('[section:xvm9aann] dto: no frontend block in dtoEntity; the browser entry registers dtoFrontendModule with routes /dtos…, sidebarTab "DTOs", chip/card/row, detailPanel, useGetBySlug, listByTags', () => {
    expectContributionWithoutFrontend(
      apiContractsManifest,
      'dto',
      'plugins/c4s-plugin-api-contracts/src/entity/dto/index.ts',
    );
    const mod = expectRegisteredByEntry('c4s-plugin-api-contracts', dtoFrontendModule, 'dto');
    expectVisible(mod, 'DTOs', ['/dtos', '/dtos/$slug', '/dtos/$slug/history']);
  });

  it('[section:vc5pzsc0] endpoint: no frontend block in endpointEntity (backend routes/mcpServer stay); the browser entry registers endpointFrontendModule with routes /endpoints…, sidebarTab "Endpoints", chip/card/row, detailPanel', () => {
    expectContributionWithoutFrontend(
      apiContractsManifest,
      'endpoint',
      'plugins/c4s-plugin-api-contracts/src/entity/endpoint/index.ts',
    );
    const backend = contributionOf(apiContractsManifest, 'endpoint').backend as Record<string, unknown>;
    expect(backend.routes).toBeDefined();
    expect(typeof backend.mcpServer).toBe('function');
    const mod = expectRegisteredByEntry('c4s-plugin-api-contracts', endpointFrontendModule, 'endpoint');
    expectVisible(mod, 'Endpoints', ['/endpoints', '/endpoints/$slug', '/endpoints/$slug/history']);
  });

  it('[section:ityp8g1r] database-table: no frontend block; the browser entry registers a visible module (list · $slug · $slug/history, sidebarTab, row/chip/card, detailPanel, useGetBySlug, listByTags) WITHOUT editorExtensions — `/database-table` is declared only by contributes.commands', () => {
    expectContributionWithoutFrontend(
      databaseTablesManifest,
      'database-table',
      'plugins/c4s-plugin-database-tables/src/entity/database-table/index.ts',
    );
    const mod = expectRegisteredByEntry(
      'c4s-plugin-database-tables',
      databaseTableFrontendModule,
      'database-table',
    );
    expectVisible(mod, 'Database Tables', [
      '/database-tables',
      '/database-tables/$slug',
      '/database-tables/$slug/history',
    ]);
    expect(mod.editorExtensions).toBeUndefined();
    const commands = (databaseTablesManifest as { contributes: { commands?: Array<Record<string, unknown>> } })
      .contributes.commands ?? [];
    const declared = commands.filter((c) => JSON.stringify(c).includes('database-table'));
    expect(declared).toHaveLength(1);
  });

  it('[section:dsmanifest] design-system: no frontend block in designSystemEntity; the envelope browser entry registers designSystemFrontendModule with routes /design-systems…, sidebarTab "Design Systems", chip/card/row, detailPanel', () => {
    expectContributionWithoutFrontend(
      frontendMockupsManifest,
      'design-system',
      'plugins/c4s-plugin-frontend-mockups/src/entity/design-system/index.ts',
    );
    const mod = expectRegisteredByEntry(
      'c4s-plugin-frontend-mockups',
      designSystemFrontendModule,
      'design-system',
    );
    const paths = routePaths(mod);
    expect(paths.slice(0, 2)).toEqual(['/design-systems', '/design-systems/$slug']);
    expectVisible(mod, 'Design Systems', paths);
  });

  it('[section:cv8b7alf] ui-view: no frontend block in uiViewEntity; the envelope browser entry registers uiViewFrontendModule with routes /ui-views, $slug, $slug/preview, $slug/history, sidebarTab "UI Views", chip/card/row, detailPanel', () => {
    expectContributionWithoutFrontend(
      frontendMockupsManifest,
      'ui-view',
      'plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/index.ts',
    );
    const mod = expectRegisteredByEntry('c4s-plugin-frontend-mockups', uiViewFrontendModule, 'ui-view');
    expectVisible(mod, 'UI Views', [
      '/ui-views',
      '/ui-views/$slug',
      '/ui-views/$slug/preview',
      '/ui-views/$slug/history',
    ]);
  });

  it('[section:atmxa1s8] mcp-tool: no frontend block (and no lucide-react import) in mcpToolEntity, no backend; the browser entry registers mcpToolFrontendModule with routes /mcp-tools…, sidebarTab "MCP Tools" without emptyState, chip/card/row, detailPanel, no editorExtensions', () => {
    expectContributionWithoutFrontend(
      mcpToolsManifest,
      'mcp-tool',
      'plugins/c4s-plugin-mcp-tools/src/entity/mcp-tool/index.ts',
    );
    expect(contributionOf(mcpToolsManifest, 'mcp-tool').backend).toBeUndefined();
    const mod = expectRegisteredByEntry('c4s-plugin-mcp-tools', mcpToolFrontendModule, 'mcp-tool');
    expectVisible(mod, 'MCP Tools', ['/mcp-tools', '/mcp-tools/$slug', '/mcp-tools/$slug/history']);
    expect(mod.editorExtensions).toBeUndefined();
  });

  it('[section:04i1idm7] module-dependency: no frontend block in moduleDependencyEntity; the browser entry registers a HIDDEN module — no sidebarTab, routes or detailPanel, renderRow/renderCard/renderChip and renderOverlay (the module-dependency-expand window content), no editorExtensions', () => {
    expectContributionWithoutFrontend(
      lvsManifest,
      'module-dependency',
      'plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/index.ts',
    );
    const mod = expectRegisteredByEntry(
      'c4s-plugin-layered-vertical-slices',
      moduleDependencyFrontendModule,
      'module-dependency',
    );
    expect(isHiddenModule(mod as unknown as FrontendModule)).toBe(true);
    expect(mod.sidebarTab).toBeUndefined();
    expect(mod.routes).toBeUndefined();
    expect(mod.detailPanel).toBeUndefined();
    expect(typeof mod.renderRow).toBe('function');
    expect(typeof mod.renderOverlay).toBe('function');
    expect(mod.editorExtensions).toBeUndefined();
  });
});
