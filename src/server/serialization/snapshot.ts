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
  SnapshotData,
} from './types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { SnapshotNotImplementedError } from './types.js';
import type { RawDeltaEntityChange } from '../../shared/entities.js';
import {
  attachSystemFields,
  readSystemFields,
  stripSystemFields,
  type SystemStamp,
} from './system-fields.js';

/**
 * 0.2.4 — the `createdAt`/`updatedAt` envelope is attached here and NOWHERE
 * else. Serializers neither read nor write it; they never learn it exists.
 *
 * The stamp comes off the entity row's audit columns, which since 0.2.4 hold a
 * verbatim copy of the file's value — so reading it off the row is reading it
 * off the file. `entity` is a `RawEntity` on every call site (the entity store's
 * `persist`, the release layer's diff/restore); anything else, or a row whose
 * table has no audit columns, simply gets no envelope.
 */
function stampOf(entity: unknown): SystemStamp | null {
  if (entity === null || typeof entity !== 'object') return null;
  const system = (entity as { system?: unknown }).system;
  if (system === null || typeof system !== 'object') return null;
  return readSystemFields(system);
}

export function snapshotEntity(
  host: PluginHost,
  type: string,
  entity: unknown,
  reader: RawEntityReader
): SnapshotData {
  const module = host.getEntity(type);
  if (!module) throw new SnapshotNotImplementedError(type);
  const fn = module.serializer.snapshot;
  if (!fn) throw new SnapshotNotImplementedError(type);
  return attachSystemFields(fn(entity, reader), stampOf(entity));
}

/**
 * Step 4 of `restoreEntity` (M17): execute through the entity's normal write-API
 * so the change lands in `entity_version` like any other — with a GENERIC
 * dispatch, per 0.2.2.
 *
 * 0.2.9 (brief item 6) removed the last enumeration here. The write door used to
 * be `host.getEntityService(type)`, so a type that declared its data but
 * contributed no service was REPORTED AS A SKIP — restorable in principle,
 * silently dropped in practice. `EntityWriter.upsert` now falls through to the
 * host's own projection write for exactly that case, so there is nothing left to
 * pre-check: an active type is a writable type. The remaining `null` from the
 * writer (type not active at all) is still degraded to a skip, but by the writer
 * and one layer down, where the distinction is actually known.
 */
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
  /**
   * 0.2.4 — detach the envelope and put it on the WRITER, not in the payload.
   *
   * The per-type `restore` slot therefore sees exactly the snapshot shape it saw
   * before 0.2.4 (it would reject the extra keys, or worse, pass them through to
   * a column that does not exist), while the service it drives writes the file's
   * timestamps into its audit columns verbatim.
   */
  const stamp = readSystemFields(data);
  if (!stamp) return fn(data, ctx);
  const stamped = ctx.writer.withStamp?.(stamp);
  return fn(stripSystemFields(data), stamped ? { ...ctx, writer: stamped } : ctx);
}

/**
 * 0.2.4 — the envelope is stripped from BOTH sides before dispatch, so a delta
 * that is nothing but a timestamp difference is structurally `noop`.
 *
 * Host-global and per-type-agnostic on purpose: this is the one place that can
 * state "a timestamp is not a substantive change" once, for every type at once,
 * including plugin-contributed types whose `diff` slot we cannot edit.
 */
export function diffEntity(
  host: PluginHost,
  type: string,
  a: SnapshotData,
  b: SnapshotData,
  slug: string
): EntityDiff {
  const lhs = stripSystemFields(a);
  const rhs = stripSystemFields(b);
  const module = host.getEntity(type);
  if (!module) {
    // Inactive plugin — fall back to default; consumers (UI, M18) will see raw deep-diff.
    return defaultDeepDiff(type, slug, lhs, rhs);
  }
  const fn = module.serializer.diff;
  if (!fn) return defaultDeepDiff(type, slug, lhs, rhs);
  return fn(lhs, rhs, slug);
}

/**
 * Shape an `EntityDiff` (from `diffEntity`) into the wire format both
 * `ReleaseService.getReleaseDiff` and the per-entity version-diff route send
 * to clients — one place for the `{type,slug,op,changes?,raw?}` spread so the
 * two call sites can't drift on which optional fields they include.
 */
export function toRawDeltaEntityChange(
  diff: EntityDiff,
  serializerMismatch?: { type: string; from: string | null; to: string | null } | null
): RawDeltaEntityChange {
  return {
    type: diff.type,
    slug: diff.slug,
    op: diff.op,
    ...(diff.changes ? { changes: diff.changes } : {}),
    ...(diff.raw ? { raw: diff.raw } : {}),
    ...(serializerMismatch ? { _serializerVersionMismatch: serializerMismatch } : {}),
  };
}

/**
 * Compute deep-diff between two SnapshotData JSONs and wrap as EntityDiff.
 *
 * Strips the 0.2.4 timestamp envelope itself rather than relying on
 * `diffEntity` having done it: this is exported and called directly (the M18
 * page/entity delta paths), and a stamp-only difference must read as `noop`
 * from every entrance, not just the dispatching one. `stripSystemFields` is a
 * no-op on already-stripped data, so the double call costs nothing.
 */
export function defaultDeepDiff(
  type: string,
  slug: string,
  aIn: SnapshotData,
  bIn: SnapshotData
): EntityDiff {
  const a = stripSystemFields(aIn);
  const b = stripSystemFields(bIn);
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
