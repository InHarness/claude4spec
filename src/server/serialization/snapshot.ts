/**
 * Host-level snapshot/restore/diff helpers for M17.
 *
 * Plugin manifest slots are owner-of-shape (each EntitySerializer decides what
 * `SnapshotData` looks like). These helpers route through the plugin host:
 *   - `snapshotEntity(host, type, ...)` — calls `serializer.snapshot(...)`;
 *     throws SnapshotNotImplementedError if the plugin has no snapshot slot
 *     (snapshot is *required* for M17 participation, unlike read-only views
 *     which fall back to raw JSON).
 *   - `restoreEntity(host, type, ...)` — calls `serializer.restore(...)`.
 *   - `diffEntity(host, type, a, b, slug)` — calls `serializer.diff(...)`
 *     when present, otherwise computes a default deep-diff.
 */

import type { PluginHost } from '../core/plugin-host/types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializeContext,
  SnapshotData,
} from './types.js';
import { SnapshotNotImplementedError } from './types.js';

export function snapshotEntity(
  host: PluginHost,
  type: string,
  entity: unknown,
  ctx: SerializeContext
): SnapshotData {
  const module = host.getEntity(type);
  if (!module) throw new SnapshotNotImplementedError(type);
  const fn = module.serializer.snapshot;
  if (!fn) throw new SnapshotNotImplementedError(type);
  return fn(entity, ctx);
}

export function restoreEntity(
  host: PluginHost,
  type: string,
  data: SnapshotData,
  ctx: RestoreContext
): RestoreResult {
  const module = host.getEntity(type);
  if (!module) throw new SnapshotNotImplementedError(type);
  const fn = module.serializer.restore;
  if (!fn) throw new SnapshotNotImplementedError(type);
  return fn(data, ctx);
}

export function diffEntity(
  host: PluginHost,
  type: string,
  a: SnapshotData,
  b: SnapshotData,
  slug: string
): EntityDiff {
  const module = host.getEntity(type);
  if (!module) {
    // Inactive plugin — fall back to default; consumers (UI, M18) will see raw deep-diff.
    return defaultDeepDiff(type, slug, a, b);
  }
  const fn = module.serializer.diff;
  if (!fn) return defaultDeepDiff(type, slug, a, b);
  return fn(a, b, slug);
}

/** Compute deep-diff between two SnapshotData JSONs and wrap as EntityDiff. */
export function defaultDeepDiff(
  type: string,
  slug: string,
  a: SnapshotData,
  b: SnapshotData
): EntityDiff {
  if (a == null && b == null) return { type, slug, op: 'noop' };
  if (a == null) return { type, slug, op: 'created', raw: deepDiffPartition(undefined, b) };
  if (b == null) return { type, slug, op: 'deleted', raw: deepDiffPartition(a, undefined) };
  if (deepEqual(a, b)) return { type, slug, op: 'noop' };
  return { type, slug, op: 'modified', raw: deepDiffPartition(a, b) };
}

function deepDiffPartition(
  a: unknown,
  b: unknown
): { added: Record<string, unknown>; removed: Record<string, unknown>; changed: Record<string, unknown> } {
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};
  partition('', a, b, added, removed, changed);
  return { added, removed, changed };
}

function partition(
  prefix: string,
  a: unknown,
  b: unknown,
  added: Record<string, unknown>,
  removed: Record<string, unknown>,
  changed: Record<string, unknown>
): void {
  if (deepEqual(a, b)) return;
  if (a === undefined) {
    added[prefix || '/'] = b;
    return;
  }
  if (b === undefined) {
    removed[prefix || '/'] = a;
    return;
  }
  if (!isObj(a) || !isObj(b)) {
    changed[prefix || '/'] = { from: a, to: b };
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const sub = prefix ? `${prefix}.${key}` : key;
    partition(sub, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], added, removed, changed);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/** Stable JSON canonicalization — sort object keys recursively. Arrays kept in order. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
