import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { EntityWriter } from './writer.js';

export type ViewKind =
  | 'inline_mention'
  | 'single_element'
  | 'element_list_item'
  | 'tagged_list_item'
  | 'detail';

/**
 * 0.2.9 — schemas are DERIVED from `data.schema`, so the type moved to
 * `shared/plugin-host/json-schema.ts` next to the deriver. Re-exported here
 * because every consumer of a schema in this layer imports from this file.
 */
export type { JsonSchema } from '../../shared/plugin-host/json-schema.js';

/**
 * A computed view: the entity wrapper in, an arbitrary payload out.
 *
 * 0.2.9 dropped the `SerializeContext` wrapper (`{reader, depth, maxDepth}`) for
 * a bare reader. `depth` was `0` at every call site in the repo, so the single
 * guard that read it never fired once; a parameter no caller ever varies is not
 * a depth limit, it is a comment. Where a view genuinely has a depth rule (dto's
 * `detail` resolves nested DTOs one level), the rule is now written into the view.
 */
export type ViewFn<T> = (entity: T, reader: RawEntityReader) => unknown;

/** The views a type computes itself. Every kind it omits is served generically. */
export type ViewSet<T> = Partial<Record<ViewKind, ViewFn<T>>>;

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

// ─── Serialization contribution (L9) ────────────────────────────────────────

/**
 * What a type contributes to serialization in Host API 2.0.0 — and it is
 * deliberately little.
 *
 * Gone from 1.x, all of it derivable from `data.schema`: `type` (the manifest
 * already says it), `version: string` (an advisory semver the registry never
 * enforced — replaced by the manifest's integer `payloadVersion`), the five flat
 * view callbacks (now one map, so "which views does this type compute?" is a
 * property of the data instead of a five-case switch), `schema?(view)` (derived
 * — see `shared/plugin-host/json-schema.ts`) and, in PR2 of this tier,
 * `snapshot`/`restore`.
 *
 * What is left is what the host genuinely cannot derive: payload shapes that are
 * COMPUTED (resolved refs, back-references, counts) and a SEMANTIC diff.
 */
export interface SerializationContribution<T = unknown> {
  /** Views this type computes. Absent kinds are served generically by the host. */
  views?: ViewSet<T>;
  /**
   * Optional semantic diff. Falls back to default deep-diff when omitted.
   *
   * The brief's snippet writes this as `(a, b) => EntityDiff`; `EntityDiff`
   * carries `slug` and every implementation builds it from the third argument,
   * so the parameter is kept and a clarification patch is filed instead.
   */
  diff?: (a: SnapshotData, b: SnapshotData, slug: string) => EntityDiff;
  /**
   * Shape version of this type's payload. Must equal the manifest's
   * `payloadVersion` — the manifest slot is the authority and registration
   * rejects a mismatch, so the two can never drift into disagreeing.
   */
  payloadVersion: number;
  /**
   * Ordered chain of payload migrations, `payloadUpgrades[i]` taking payload
   * `i+1` to `i+2`. DECLARED here in PR1; ENFORCED (on file load, rebuild and
   * release restore) by PR2 of this tier.
   */
  payloadUpgrades?: Array<(payload: SnapshotData) => SnapshotData>;

  // ─── M17 Spec Snapshots ──────────────────────────────────────────────────
  /**
   * @deprecated Tier B PR2 deletes both slots: snapshot and restore are
   * generated from `data.schema`. They survive PR1 only so that M17 releases
   * keep working across the two commits.
   */
  snapshot?: (entity: T, reader: RawEntityReader) => SnapshotData;
  /** @deprecated See {@link SerializationContribution.snapshot}. */
  restore?: (data: SnapshotData, ctx: RestoreContext) => RestoreResult;
}

export interface SerializeResult {
  data: unknown;
  /**
   * True when the host built this payload from the projection row rather than
   * the type computing it. 0.2.9 renamed it from `fallback`: a type that
   * declares its data and computes nothing is FULLY served, not degraded, so
   * "generic" is the rule and "fallback" was the wrong word for the common case.
   */
  generic: boolean;
  error?: string;
  brokenRefs?: string[];
}
