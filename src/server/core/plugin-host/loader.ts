/**
 * M33 plugin loader — the single mechanism that turns workspace-declared npm
 * packages into registered host capabilities, run identically from every entry
 * point (server, `c4s`, `c4s-mcp`, `c4s-reader`).
 *
 * Four steps, per package, each isolated in its own try/catch so a single bad
 * plugin is skipped — never crashing the process:
 *   1. Dynamic import      — `await import(pkg)` (native ESM).
 *   2. Manifest extraction — `mod.manifest` or `mod.default`.
 *   3. Validation gate     — hostApiVersion range + engines.node.
 *   4. Registration        — `registry.registerPlugin(manifest)`.
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import semver from 'semver';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import { buildMigrationInfo, type PluginMigrationInfo } from '../../../shared/plugin-host/host-api.js';
import { entryCacheBust } from './cache-bust.js';
import { installPluginRuntimeResolver } from './plugin-runtime-resolver.js';
import type { PluginRegistry } from './types.js';

/**
 * `incompatible` (M33) is distinct from `skipped`: it means the package
 * was built against an incompatible MAJOR Host API and carries a `migration`
 * descriptor (a repair path), whereas `skipped` is an environment problem (an
 * `engines` miss) with no migration path.
 */
export type PluginLoadStatus = 'loaded' | 'skipped' | 'incompatible' | 'failed';

export type PluginLoadCode =
  | 'PLUGIN_HOST_API_MISMATCH'
  | 'PLUGIN_ENGINE_UNSATISFIED'
  | 'PLUGIN_IMPORT_FAILED'
  | 'PLUGIN_INVALID_MANIFEST'
  // Overlay layer:
  | 'PLUGIN_TYPE_CONFLICT'
  | 'PLUGIN_PROJECT_UNTRUSTED';

/** Which layer a record belongs to — base (workspace/npm) vs overlay (project-local). */
export type PluginLayer = 'base' | 'overlay';

/**
 * Per-package outcome. Adds `layer` (base/overlay), `trust`, `origin`
 * (project-local source path), and `shadows`/`shadowedTypes` — all optional so
 * base records keep their shape.
 */
export interface PluginLoadRecord {
  /** Source identifier: the npm package name, or a synthetic id for built-ins. */
  package: string;
  status: PluginLoadStatus;
  /** Machine code for skipped/failed packages. */
  code?: PluginLoadCode;
  /** Human-readable explanation for skipped/failed packages. */
  reason?: string;
  manifestName?: string;
  manifestVersion?: string;
  /** Entity types this package contributed (only when `loaded`). */
  contributedTypes?: string[];
  /** Which layer this record came from (base/overlay). */
  layer?: PluginLayer;
  /** Trust state of the project-local layer (overlay only). */
  trust?: 'trusted' | 'untrusted';
  /** Source path under `<cwd>/.claude4spec/plugins/` (overlay only). */
  origin?: string;
  /**
   * M33: present on `incompatible` records — the repair path (target
   * Host API version, applicable migration descriptors, shim availability).
   */
  migration?: PluginMigrationInfo;
}

export interface PluginLoadResult {
  records: PluginLoadRecord[];
}

/** Module importer — overridable in tests; defaults to native dynamic import. */
export type PluginImporter = (specifier: string) => Promise<unknown>;
const defaultImporter: PluginImporter = (specifier) => import(specifier);

/** Pull the `PluginManifest` off a freshly-imported module namespace. Shared by
 * the workspace loader and the project-local overlay loader. */
export function extractManifest(mod: unknown): PluginManifest | null {
  if (mod == null || typeof mod !== 'object') return null;
  const ns = mod as Record<string, unknown>;
  const candidate = (ns.manifest ?? ns.default) as PluginManifest | undefined;
  if (candidate == null || typeof candidate !== 'object') return null;
  return candidate;
}

/** A structurally-valid manifest carries at least string `name` + `hostApiVersion`. */
export function isValidManifestShape(manifest: PluginManifest | null): manifest is PluginManifest {
  return (
    manifest != null &&
    typeof manifest.name === 'string' &&
    typeof manifest.hostApiVersion === 'string'
  );
}

/** engines.node satisfied by the running node? Missing constraint = satisfied. */
function enginesSatisfied(manifest: PluginManifest): boolean {
  const node = manifest.engines?.node;
  if (!node) return true;
  return semver.satisfies(process.versions.node, node);
}

/**
 * Outcome of the compatibility gate. `status` lets the caller record an
 * `incompatible` (major Host API mismatch — carries a `migration` repair path)
 * distinctly from a `skipped` (host-api same-major miss, or an `engines` miss —
 * environment problems with no migration path).
 */
export interface GateResult {
  status: 'skipped' | 'incompatible';
  code: PluginLoadCode;
  reason: string;
  migration?: PluginMigrationInfo;
}

/**
 * Compatibility gate shared by all layers: hostApiVersion range + engines.node.
 * Returns `null` when the manifest may register; otherwise the gate result.
 * A MAJOR Host API mismatch → `incompatible` + a migration descriptor; an
 * `engines` miss (or a same-major host-api miss) → `skipped`.
 */
export function gateManifest(manifest: PluginManifest): GateResult | null {
  if (!semver.satisfies(HOST_API_VERSION, manifest.hostApiVersion)) {
    const migration = buildMigrationInfo(manifest.hostApiVersion);
    return {
      status: migration ? 'incompatible' : 'skipped',
      code: 'PLUGIN_HOST_API_MISMATCH',
      reason: `host API ${HOST_API_VERSION} does not satisfy plugin requirement "${manifest.hostApiVersion}"`,
      migration: migration ?? undefined,
    };
  }
  if (!enginesSatisfied(manifest)) {
    return {
      status: 'skipped',
      code: 'PLUGIN_ENGINE_UNSATISFIED',
      reason: `node ${process.versions.node} does not satisfy engines.node "${manifest.engines?.node}"`,
    };
  }
  return null;
}

/**
 * Load and register the given workspace plugin packages onto `registry`.
 * Returns one record per package for the diagnostics route. Never throws.
 */
export async function loadWorkspacePlugins(
  registry: PluginRegistry,
  packageNames: string[],
  importer: PluginImporter = defaultImporter,
): Promise<PluginLoadResult> {
  const records: PluginLoadRecord[] = [];

  // Bind the bare `@c4s/plugin-runtime` alias before the first plugin import.
  // Installing here rather than at the call sites keeps this the "single mechanism
  // run identically from every entry point" the docblock above promises. Skipped
  // when there is nothing to load, so a plugin-free CLI never spawns a loader thread.
  if (packageNames.length > 0) installPluginRuntimeResolver();

  for (const pkg of packageNames) {
    let mod: unknown;
    try {
      mod = await importer(pkg);
    } catch (err) {
      const reason = (err as Error).message;
      console.warn(`[plugin-loader] PLUGIN_IMPORT_FAILED ${pkg}: ${reason}`);
      records.push({ package: pkg, status: 'failed', code: 'PLUGIN_IMPORT_FAILED', reason });
      continue;
    }

    const manifest = extractManifest(mod);
    if (!isValidManifestShape(manifest)) {
      const reason = 'package does not export a valid PluginManifest (manifest/default)';
      console.warn(`[plugin-loader] PLUGIN_INVALID_MANIFEST ${pkg}: ${reason}`);
      records.push({ package: pkg, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason });
      continue;
    }

    const base: PluginLoadRecord = {
      package: pkg,
      status: 'loaded',
      layer: 'base',
      manifestName: manifest.name,
      manifestVersion: manifest.version,
    };

    const gate = gateManifest(manifest);
    if (gate) {
      console.warn(`[plugin-loader] ${gate.code} ${pkg}: ${gate.reason}`);
      records.push({
        ...base,
        status: gate.status,
        code: gate.code,
        reason: gate.reason,
        migration: gate.migration,
      });
      continue;
    }

    try {
      registry.registerPlugin(manifest);
    } catch (err) {
      const reason = (err as Error).message;
      console.warn(`[plugin-loader] PLUGIN_INVALID_MANIFEST ${pkg}: ${reason}`);
      records.push({ ...base, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason });
      continue;
    }

    records.push({
      ...base,
      contributedTypes: (manifest.contributes.entities ?? []).map((e) => e.type),
    });
  }

  return { records };
}

/**
 * Resolve a base package's main entry (the `.` export) to an absolute path,
 * using the SAME ESM resolution as the bootstrap `import(pkg)` — `import.meta.resolve`
 * honors the `import` condition, so an ESM-only package (`exports["."]` with only
 * `import`, no `require`/`default`) resolves where CJS `createRequire(...).resolve`
 * would throw `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *
 * Shared by the reload cache-bust (here, via `reloadPlugin`) and the base-watcher
 * dir discovery (`server/index.ts`) so load and watch can never drift: a package
 * that loads at bootstrap is observable by the base watcher, identically.
 */
export function resolveBaseEntry(pkg: string): string | null {
  try {
    return fileURLToPath(import.meta.resolve(pkg));
  } catch {
    return null;
  }
}

/** Seams for `reloadPlugin` — overridable in tests. */
export interface ReloadPluginOptions {
  importer?: PluginImporter;
  resolveEntry?: (pkg: string) => string | null;
  cacheBust?: (entry: string) => string;
}

/**
 * M33 — hot-reload pipeline for ONE base (workspace/npm) package.
 *
 * Atomicity: the failure modes the brief names "old stays" — import failure,
 * missing manifest export, incompatible major — are all checked BEFORE any
 * teardown, so the previously-registered version remains registered and the
 * caller surfaces a warning. Only once a fresh, compatible manifest is in hand
 * do we tear the old version down (`unregisterPlugin` → its `onUnregister`) and
 * register the new one — the brief's "onUnregister old, then register new".
 *
 * Returns the per-package record (`loaded` / `skipped` / `failed`). Never throws.
 */
export async function reloadPlugin(
  registry: PluginRegistry,
  pkg: string,
  opts: ReloadPluginOptions = {},
): Promise<PluginLoadRecord> {
  const importer = opts.importer ?? defaultImporter;
  const resolveEntry = opts.resolveEntry ?? resolveBaseEntry;
  const cacheBust = opts.cacheBust ?? entryCacheBust;
  const base: PluginLoadRecord = { package: pkg, status: 'loaded', layer: 'base' };

  // Independently of `loadWorkspacePlugins`: a reload can be the first plugin import
  // of a process (e.g. a `tsx watch` respawn). The latch makes the repeat call free.
  // Note the cache-bust below busts the PLUGIN entry, never the host barrel — so a
  // reloaded plugin keeps resolving to the same live facade instance.
  installPluginRuntimeResolver();

  const entry = resolveEntry(pkg);
  const specifier = entry ? pathToFileURL(entry).href + cacheBust(entry) : pkg;

  let mod: unknown;
  try {
    mod = await importer(specifier);
  } catch (err) {
    const reason = (err as Error).message;
    console.warn(`[plugin-loader] reload PLUGIN_IMPORT_FAILED ${pkg}: ${reason} (old version retained)`);
    return { ...base, status: 'failed', code: 'PLUGIN_IMPORT_FAILED', reason };
  }

  const manifest = extractManifest(mod);
  if (!isValidManifestShape(manifest)) {
    const reason = 'package does not export a valid PluginManifest (manifest/default)';
    console.warn(`[plugin-loader] reload PLUGIN_INVALID_MANIFEST ${pkg}: ${reason} (old version retained)`);
    return { ...base, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason };
  }

  const named = { ...base, manifestName: manifest.name, manifestVersion: manifest.version };
  const gate = gateManifest(manifest);
  if (gate) {
    console.warn(`[plugin-loader] reload ${gate.code} ${pkg}: ${gate.reason} (old version retained)`);
    return { ...named, status: gate.status, code: gate.code, reason: gate.reason, migration: gate.migration };
  }

  // Atomicity: validate + lower the NEW manifest BEFORE tearing the old one
  // down, so a structurally-broken new version leaves the old one in place
  // (parity with the import/gate failures above — "old stays").
  try {
    registry.validatePlugin(manifest);
  } catch (err) {
    const reason = (err as Error).message;
    console.warn(`[plugin-loader] reload PLUGIN_INVALID_MANIFEST ${pkg}: ${reason} (old version retained)`);
    return { ...named, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason };
  }
  // Fresh, compatible, valid: tear the old version down, then register the new.
  registry.unregisterPlugin(manifest.name);
  registry.registerPlugin(manifest);

  return {
    ...named,
    contributedTypes: (manifest.contributes.entities ?? []).map((e) => e.type),
  };
}
