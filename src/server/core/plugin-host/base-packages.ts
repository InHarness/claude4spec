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

import type { PluginRegistry, ShadowedType } from './types.js';
import type { PluginLoadRecord } from './loader.js';
import { refRegistrationWarnings, withRefWarnings } from './ref-warnings.js';

export const SYNTHETIC_BUILTIN_PACKAGE = '@c4s/builtin';

/**
 * 2.1.63 (M13 `m13pool0` „Dwie osie raportowania”) — the TYPE axis of
 * `_meta/plugins`, reported beside (never mixed into) the package axis
 * (`packages[].status`: `loaded` / `skipped` / `incompatible` / `failed`, and
 * `untrusted-skipped` overlay records). One entry per type of the effective
 * pool: `active` when one layer backs it, `shadowed` when a project overlay
 * module backs it in place of the base one. An overlay package is `loaded` and
 * the base type it shadows is `shadowed` — both at once.
 */
export interface PoolTypeState {
  type: string;
  state: 'active' | 'shadowed';
  /** Who contributes the type in each layer: the base package, the overlay source path. */
  origin: { base?: string; overlay?: string };
}

/** `type → origin` of every `loaded` record that contributed it. */
function originsByType(records: readonly PluginLoadRecord[], originOf: (r: PluginLoadRecord) => string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of records) {
    if (r.status !== 'loaded') continue;
    for (const type of r.contributedTypes ?? []) out.set(type, originOf(r));
  }
  return out;
}

/**
 * The type axis for the given pool. The STATE is the host's answer — `shadowed`
 * is a type its `shadowReport()` names (an overlay module backs it in place of
 * the base one); the ORIGINS are read off the layers' load records. The
 * process-global route passes no overlay at all (the base alone), so every type
 * there is `active`.
 */
export function poolTypeStates(
  poolTypes: readonly string[],
  basePackages: readonly PluginLoadRecord[],
  overlay: { records: readonly PluginLoadRecord[]; shadowed: readonly ShadowedType[] } = { records: [], shadowed: [] },
): PoolTypeState[] {
  const base = originsByType(basePackages, (r) => r.package);
  const local = originsByType(overlay.records, (r) => r.origin ?? r.package);
  const shadowedBy = new Map(overlay.shadowed.map((s) => [s.type, s.overlayOrigin]));
  return poolTypes.map((type) => {
    const shadow = shadowedBy.get(type);
    const origin: PoolTypeState['origin'] = {};
    const b = base.get(type);
    const o = shadow ?? local.get(type);
    if (b !== undefined) origin.base = b;
    if (o !== undefined) origin.overlay = o;
    return { type, state: shadow !== undefined ? 'shadowed' : 'active', origin };
  });
}

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
  // 2.1.41 — ref registration warnings, judged against the whole base pool.
  return withRefWarnings(
    [builtinRecord, ...pluginRecords.map((r) => ({ ...r, layer: r.layer ?? 'base' }))],
    refRegistrationWarnings(pluginRegistry.listAvailable()),
  );
}
