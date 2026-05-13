import type { RawEntityReader } from '../domain/raw-entity-reader.js';
import type { EntityWriter } from './writer.js';

export type ViewKind =
  | 'inline_mention'
  | 'single_element'
  | 'element_list_item'
  | 'tagged_list_item'
  | 'detail';

export type JsonSchema = Record<string, unknown>;

export interface SerializeContext {
  reader: RawEntityReader;
  depth: number;
  maxDepth: number;
}

export type SerializeFn<T> = (entity: T, ctx: SerializeContext) => unknown;

// ─── Snapshot view (M17) — types ────────────────────────────────────────────

/** Plugin decides shape; recommendation: similar to single_element + tags + relations. */
export type SnapshotData = unknown;

export type FieldChange = Record<string, unknown>;

export interface EntityDiff {
  type: string;
  slug: string;
  op: 'created' | 'deleted' | 'modified' | 'noop';
  /** Plugin-defined structured changes (e.g. dto_added, tag_removed, ...). */
  changes?: Record<string, unknown>;
  /** Default deep-diff fallback when plugin does not override `diff`. */
  raw?: { added: Record<string, unknown>; removed: Record<string, unknown>; changed: Record<string, unknown> };
}

export interface RestoreContext {
  reader: RawEntityReader;
  /** Normal write-API per type — restore goes through `entity_version` capture. */
  writer: EntityWriter;
  /** Informational: which release we're restoring from (does not change UPSERT semantics). */
  releaseId: number | null;
  /** Who initiated the restore — passed through to entity_version.changed_by. */
  actor: 'user' | 'agent';
}

export interface RestoreResult<T = unknown> {
  op: 'created' | 'updated' | 'deleted' | 'noop';
  entity: T | null;
  warnings?: string[];
}

export class SnapshotNotImplementedError extends Error {
  constructor(type: string) {
    super(`type '${type}' has no snapshot slot — cannot participate in M17 release`);
    this.name = 'SnapshotNotImplementedError';
  }
}

// ─── Serializer interface ───────────────────────────────────────────────────

export interface EntitySerializer<T = unknown> {
  type: string;
  version: string;
  inlineMention?: SerializeFn<T>;
  singleElement?: SerializeFn<T>;
  elementListItem?: SerializeFn<T>;
  taggedListItem?: SerializeFn<T>;
  detail?: SerializeFn<T>;
  schema?: (view: ViewKind) => JsonSchema;

  // ─── M17 Spec Snapshots ──────────────────────────────────────────────────
  /** Deterministic, byte-identical snapshot. Pure function of state — no clock, no random. */
  snapshot?: (entity: T, ctx: SerializeContext) => SnapshotData;
  /**
   * Inverse of snapshot — UPSERT through normal write-API; idempotent.
   * Result entity is the domain type (Endpoint/Dto/...), not the read-view T,
   * so restore is intentionally typed `RestoreResult<unknown>` — consumers
   * downcast on per-type basis.
   */
  restore?: (data: SnapshotData, ctx: RestoreContext) => RestoreResult;
  /** Optional semantic diff. Falls back to default deep-diff when omitted. */
  diff?: (a: SnapshotData, b: SnapshotData, slug: string) => EntityDiff;
}

export interface SerializeResult {
  data: unknown;
  fallback: boolean;
  error?: string;
  brokenRefs?: string[];
}
