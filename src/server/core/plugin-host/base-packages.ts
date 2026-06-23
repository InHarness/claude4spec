/**
 * M33 — base-layer package records, shared by the process-global
 * `/api/_meta/plugins` route AND the server-free `c4s plugins` CLI so the two
 * never diverge. Kept free of express (the CLI must not pull the router in).
 *
 * Produces a synthetic `@c4s/builtin` record for the in-host built-in types,
 * followed by the workspace/npm loader records. `pluginRegistry` here is the
 * BASE registry — never a per-project host — so built-in detection excludes
 * overlay types.
 */

import type { PluginRegistry } from './types.js';
import type { PluginLoadRecord } from './loader.js';

export const SYNTHETIC_BUILTIN_PACKAGE = '@c4s/builtin';

export function buildBasePluginPackages(
  pluginRegistry: PluginRegistry,
  pluginRecords: PluginLoadRecord[],
): PluginLoadRecord[] {
  const loadedTypes = new Set(
    pluginRecords.flatMap((r) => (r.status === 'loaded' ? (r.contributedTypes ?? []) : [])),
  );
  const builtinTypes = pluginRegistry
    .listAvailable()
    .map((m) => m.type)
    .filter((t) => !loadedTypes.has(t));
  const builtinRecord: PluginLoadRecord = {
    package: SYNTHETIC_BUILTIN_PACKAGE,
    status: 'loaded',
    layer: 'base',
    contributedTypes: builtinTypes,
  };
  return [builtinRecord, ...pluginRecords.map((r) => ({ ...r, layer: r.layer ?? 'base' }))];
}
