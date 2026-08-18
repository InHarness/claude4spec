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
 *   - `diffEntity(host, type, a, b)` — GENERATES the semantic delta from the
 *     type's `data.schema` (`./schema-diff.ts`). No slot is consulted: 0.2.31
 *     removed the `diff?` contribution and with it the second, deep-diff mode.
 */

import type { PluginHost } from '../core/plugin-host/types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SnapshotData,
} from './types.js';
import type { RawEntity, RawEntityReader } from '../discovery/raw-entity-reader.js';
import { SnapshotNotImplementedError } from './types.js';
import { restoreFromSchema, snapshotFromSchema } from './schema-snapshot.js';
import type { RawDeltaEntityChange } from '../../shared/entities.js';
import {
  attachSystemFields,
  readSystemFields,
  stripSystemFields,
  type SystemStamp,
} from './system-fields.js';
import { diffFromSchema } from './schema-diff.js';

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

/**
 * 0.2.9 tier B PR2 — GENERATED from `data.schema`, for every type.
 *
 * The per-type `snapshot` slot is gone. `SnapshotNotImplementedError` survives
 * and means something narrower now: not "this type never wrote a snapshot
 * function" but "this type is not active, or declares no data" — which for a
 * declarative host is the same sentence as "there is nothing to snapshot".
 */
export function snapshotEntity(
  host: PluginHost,
  type: string,
  entity: unknown,
  reader: RawEntityReader
): SnapshotData {
  const module = host.getEntity(type);
  if (!module?.data?.schema) throw new SnapshotNotImplementedError(type);
  return attachSystemFields(
    snapshotFromSchema(module, entity as RawEntity, reader),
    stampOf(entity),
  );
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
  if (!module?.data?.schema) throw new SnapshotNotImplementedError(type);
  /**
   * 0.2.4 — detach the envelope and put it on the WRITER, not in the payload.
   *
   * The generated restore therefore sees only declared fields, and the service
   * it drives writes the file's timestamps into its audit columns verbatim. The
   * stamp riding on the writer rather than in the payload is also what keeps a
   * payload upgrade from stamping `updatedAt`: the upgrade rewrites the data,
   * the envelope it travelled with is unchanged, and the writer still writes the
   * file's original value.
   */
  const stamp = readSystemFields(data);
  if (!stamp) return restoreFromSchema(module, data, ctx);
  const stamped = ctx.writer.withStamp?.(stamp);
  return restoreFromSchema(
    module,
    stripSystemFields(data),
    stamped ? { ...ctx, writer: stamped } : ctx,
  );
}

/**
 * The delta between two snapshots of one entity, GENERATED from the schema.
 *
 * 0.2.31 — there is no dispatch left to do. The function used to look up the
 * type's `diff` slot, call it when present and deep-diff when absent; both the
 * slot and the fallback are gone, so what remains is: strip the timestamp
 * envelope, walk the declaration, wrap the result.
 *
 * The envelope is stripped from BOTH sides here rather than inside the engine
 * because this is the one place that can say "a timestamp is not a substantive
 * change" once, for every type at once. (The engine also skips `systemManaged`
 * fields, which is the same rule stated where the declaration is visible — the
 * two agree, and either alone would be enough.)
 *
 * An UNKNOWN or deactivated type has no schema to walk, so it makes no claim
 * about WHAT changed — but it still reports THAT something did. Silence would
 * be worse than vagueness here: `getReleaseDiff` skips `noop`, so a `noop` on a
 * genuinely edited entity would drop it out of the release listing altogether,
 * and a plugin deactivated between two releases would quietly take its entities'
 * history with it. An empty `changes` on `updated` is the same statement
 * `created` and `deleted` already make: something happened, the full state is in
 * the snapshot.
 */
export function diffEntity(
  host: PluginHost,
  type: string,
  a: SnapshotData,
  b: SnapshotData
): EntityDiff {
  const lhs = stripSystemFields(a);
  const rhs = stripSystemFields(b);
  if (lhs == null && rhs == null) return { op: 'noop', changes: [] };

  const schema = host.getEntity(type)?.data?.schema;
  /**
   * `created` and `deleted` carry NO operations.
   *
   * Both consumers that exist — the M17 release card and the MCP projection —
   * render one bullet for these and take the full entity state from the
   * snapshot, which they have. Emitting a per-field list nobody reads would put
   * a whole entity body inside a delta, including the `contentBearing` fields
   * the opaque encoding exists to keep out of one.
   */
  if (lhs == null) return { op: 'created', changes: [] };
  if (rhs == null) return { op: 'deleted', changes: [] };
  if (!schema) {
    return deepEqual(lhs, rhs) ? { op: 'noop', changes: [] } : { op: 'updated', changes: [] };
  }

  const changes = diffFromSchema(schema, lhs, rhs);
  return changes.length ? { op: 'updated', changes } : { op: 'noop', changes: [] };
}

/**
 * Shape an `EntityDiff` into the wire format both `ReleaseService.getReleaseDiff`
 * and the per-entity version-diff route send to clients.
 *
 * The identity lives HERE and not on `EntityDiff` — the delta is recursive
 * (`item_modified.changes` carries the same dictionary), so a `type`/`slug` pair
 * on the envelope would have to be repeated meaninglessly at every nesting
 * level. Identity is a property of the row, the delta is a property of the
 * content.
 */
export function toRawDeltaEntityChange(
  type: string,
  slug: string,
  diff: EntityDiff,
  serializerMismatch?: { type: string; from: string | null; to: string | null } | null
): RawDeltaEntityChange {
  return {
    type,
    slug,
    op: diff.op,
    changes: diff.changes,
    ...(serializerMismatch ? { _serializerVersionMismatch: serializerMismatch } : {}),
  };
}

/** Key-order-insensitive equality — the only comparison available when a type
 *  has no declaration to compare it BY. */
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
