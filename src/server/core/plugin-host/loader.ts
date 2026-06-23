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

import semver from 'semver';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type { PluginRegistry } from './types.js';

export type PluginLoadStatus = 'loaded' | 'skipped' | 'failed';

export type PluginLoadCode =
  | 'PLUGIN_HOST_API_MISMATCH'
  | 'PLUGIN_ENGINE_UNSATISFIED'
  | 'PLUGIN_IMPORT_FAILED'
  | 'PLUGIN_INVALID_MANIFEST';

/**
 * Per-package outcome. Shape is an extensible record so phase 2 can add
 * `layer` (base/overlay), `trust`, and `shadowed` without breaking consumers.
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
}

export interface PluginLoadResult {
  records: PluginLoadRecord[];
}

/** Module importer — overridable in tests; defaults to native dynamic import. */
export type PluginImporter = (specifier: string) => Promise<unknown>;
const defaultImporter: PluginImporter = (specifier) => import(specifier);

function extractManifest(mod: unknown): PluginManifest | null {
  if (mod == null || typeof mod !== 'object') return null;
  const ns = mod as Record<string, unknown>;
  const candidate = (ns.manifest ?? ns.default) as PluginManifest | undefined;
  if (candidate == null || typeof candidate !== 'object') return null;
  return candidate;
}

/** engines.node satisfied by the running node? Missing constraint = satisfied. */
function enginesSatisfied(manifest: PluginManifest): boolean {
  const node = manifest.engines?.node;
  if (!node) return true;
  return semver.satisfies(process.versions.node, node);
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
    if (!manifest || typeof manifest.name !== 'string' || typeof manifest.hostApiVersion !== 'string') {
      const reason = 'package does not export a valid PluginManifest (manifest/default)';
      console.warn(`[plugin-loader] PLUGIN_INVALID_MANIFEST ${pkg}: ${reason}`);
      records.push({ package: pkg, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason });
      continue;
    }

    const base: PluginLoadRecord = {
      package: pkg,
      status: 'loaded',
      manifestName: manifest.name,
      manifestVersion: manifest.version,
    };

    if (!semver.satisfies(HOST_API_VERSION, manifest.hostApiVersion)) {
      const reason = `host API ${HOST_API_VERSION} does not satisfy plugin requirement "${manifest.hostApiVersion}"`;
      console.warn(`[plugin-loader] PLUGIN_HOST_API_MISMATCH ${pkg}: ${reason}`);
      records.push({ ...base, status: 'skipped', code: 'PLUGIN_HOST_API_MISMATCH', reason });
      continue;
    }

    if (!enginesSatisfied(manifest)) {
      const reason = `node ${process.versions.node} does not satisfy engines.node "${manifest.engines?.node}"`;
      console.warn(`[plugin-loader] PLUGIN_ENGINE_UNSATISFIED ${pkg}: ${reason}`);
      records.push({ ...base, status: 'skipped', code: 'PLUGIN_ENGINE_UNSATISFIED', reason });
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
