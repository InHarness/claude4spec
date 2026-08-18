import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { EntityWriter } from './writer.js';

/**
 * 0.2.9 — schemas are DERIVED from `data.schema`, so the type moved to
 * `shared/plugin-host/json-schema.ts` next to the deriver. Re-exported here
 * because every consumer of a schema in this layer imports from this file.
 */
export type { JsonSchema } from '../../shared/plugin-host/json-schema.js';

// ─── Snapshot view (M17) — types ────────────────────────────────────────────

/** Plugin decides shape; recommendation: similar to single_element + tags + relations. */
export type SnapshotData = unknown;

/**
 * 0.2.31 — the delta contract lives in `shared/plugin-host/data-schema.ts`,
 * next to the declaration it is generated FROM, because the client renders the
 * same eight operations the server produces. Re-exported here because every
 * consumer in this layer imports its types from this file.
 */
export type { DiffOp, EntityDiff, IdentityKey } from '../../shared/plugin-host/data-schema.js';

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

/**
 * 0.2.9 — the same error, a narrower meaning.
 *
 * It used to mean "this type wrote no snapshot function". Snapshot is generated
 * now, so the only way one can be missing is a type that is not active or
 * declares no data — which for a declarative host is the same sentence as
 * "there is nothing to snapshot".
 */
export class SnapshotNotImplementedError extends Error {
  constructor(type: string) {
    super(`type '${type}' is not active or declares no data.schema — cannot participate in M17 release`);
    this.name = 'SnapshotNotImplementedError';
  }
}

/**
 * The ONE error the read lookup can produce: the type is unknown or deactivated.
 *
 * 0.2.23 narrowed the contract to this single case. The other two the engine
 * used to report are gone with the code that produced them — a view outside the
 * enum (`INVALID_VIEW`) and a type's own serializer throwing (`SERIALIZER_THREW`)
 * both presupposed author code in the read path. M39 maps this to `INVALID_TYPE`.
 */
export class SerializerError extends Error {
  constructor(type: string) {
    super(`type '${type}' is not registered or not active — no read record can be derived`);
    this.name = 'SerializerError';
  }
}

// ─── Serialization contribution (L9) ────────────────────────────────────────

/**
 * What a type contributes to serialization in Host API 2.0.0 — and it is
 * deliberately little.
 *
 * Gone from 1.x, all of it derivable from `data.schema`: `type` (the manifest
 * already says it), `version: string` (an advisory semver the registry never
 * enforced — replaced by the manifest's integer `payloadVersion`),
 * `schema?(view)` (derived — see `shared/plugin-host/json-schema.ts`) and, in PR2
 * of this tier, `snapshot`/`restore`.
 *
 * 0.2.23 removed the last of it: the `views?` map. A type contributed READ CODE
 * for as long as the shape of a read was a closed list of variants each type
 * declared; the shape is now `f(schema, select)`, computed by the host for every
 * type at once, so there is nothing left for a view to decide. What survives is
 * the one axis a schema genuinely cannot express — the payload's history
 * (`payloadVersion` + `payloadUpgrades?`).
 *
 * 0.2.31 removed the last one that was not that: `diff?`. The delta is
 * GENERATED from `data.schema` and the `collection.identity` declarations on
 * it (`./schema-diff.ts`), so what a type says about its own delta is now said
 * in the same declaration it says everything else in. A manifest still carrying
 * the key is rejected at registration — see `manifest-adapter.ts`.
 */
export interface SerializationContribution<T = unknown> {
  /**
   * Optional echo of the manifest's `payloadVersion`.
   *
   * The MANIFEST slot is the authority and the only one anything reads
   * (`engine.getPayloadVersion`, `catalog`, `release`, `VersionService`). This
   * one exists because the brief declares the field on the contribution; it is
   * optional because a required duplicate is a fact every author writes twice
   * and eventually writes twice differently. When present, registration rejects
   * it if it disagrees with the manifest.
   */
  payloadVersion?: number;
  /**
   * Ordered chain of payload migrations, `payloadUpgrades[i]` taking payload
   * `i+1` to `i+2`.
   *
   * ENFORCED as of 0.2.9 tier B PR2 — see `./payload-upgrade.ts` for what runs
   * it and `../services/entity-indexer.ts` for where. Registration checks the
   * chain's LENGTH against `payloadVersion`, so a bump without a step (or a step
   * without a bump) is a registration error rather than a corpus that silently
   * fails to migrate.
   */
  payloadUpgrades?: Array<(payload: SnapshotData) => SnapshotData>;

  // The `snapshot` and `restore` slots are GONE as of 0.2.9 tier B PR2. Both are
  // generated from `data.schema` (`./schema-snapshot.ts`) — the last of the six
  // separate descriptions a type used to hand-write about one field set. Leaving
  // them as optional overrides was considered and rejected: an override is a
  // place for the two descriptions to drift, and drift is precisely what was
  // found when they were compared (endpoint's snapshot spelled its junction in
  // column names and contradicted its own `default: ''` on `summary`).
  // A stale 1.x slot is rejected at registration, not ignored.
}

/**
 * One field, because there is one producer.
 *
 * `generic` used to say whether the host or the type shaped the payload, and
 * `error` / `brokenRefs` reported what went wrong when the type's own code ran.
 * All three described a fork that no longer exists: the host is the only
 * producer, it cannot disagree with itself, and there is no author code left to
 * throw or to half-resolve a reference.
 */
export interface SerializeResult {
  data: unknown;
}
