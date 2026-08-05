/**
 * Host API 2.0.0, items 28 + 31 — create / update / delete for a type the host
 * knows nothing about beyond its `data.schema`.
 *
 * The write half of the declarative contract. `db/projection-write.ts` already
 * owned the ROW (validation, audit stamps, `entity_version` capture, projected
 * collections); this owns everything AROUND it that a per-type service used to
 * do by hand, six times over:
 *
 *   - mint the slug from `slugPattern`, with the historical `-2`/`-3`
 *     collision suffix. This is the first server-side consumer of
 *     `evaluateSlugPattern` — 0.2.9 tier A landed the grammar and every type's
 *     declaration, and left the six `slugFrom` functions still doing the work
 *     ("staged data, not yet the live rule"). Tier K deletes those, so this is
 *     now the rule for every type.
 *   - merge the tri-state update onto the current payload. The projection
 *     upsert names every column unconditionally, so handing it a PATCH body
 *     would blank every field the caller did not mention.
 *   - assign tags, persist the entity file, and drop the old file on a rename.
 *
 * THERE IS NO SERVICE FORK ANY MORE. This module used to defer to a registered
 * `backend.service` where one existed, on the reasoning that a service carried
 * domain validation the declaration could not express — which was true only
 * because the declaration did not yet exist. Tier K deletes the six services;
 * every type now writes through here, which is also what makes the write path
 * one thing to test rather than two (item 63's plug-and-play test exercises the
 * only branch there is).
 */

import { customAlphabet } from 'nanoid';
import { DomainError } from '../../services/tags.js';
import { evaluateSlugPattern } from '../../../shared/plugin-host/slug-pattern.js';
import type { ChangedBy } from '../../../shared/entities.js';
import type { RawEntity, RawEntityReader, RawEntityType } from '../../discovery/raw-entity-reader.js';
import type { EntityStore } from '../../services/entity-store.js';
import type { TagsService } from '../../services/tags.js';
import type { ReferencesService } from '../../services/references.js';
import type { ProjectPluginHost, BackendModule } from './types.js';
import { snapshotFromSchema } from '../../serialization/schema-snapshot.js';
import {
  removeProjectionRow,
  renameProjectionRow,
  upsertProjectionRow,
  type ProjectionWriteDeps,
} from '../../db/projection-write.js';

export interface GenericCrudDeps {
  host: ProjectPluginHost;
  reader: RawEntityReader;
  tags: TagsService;
  store: EntityStore;
  references: ReferencesService;
  projection: ProjectionWriteDeps;
}

/**
 * Write the ROW only — this module owns the version capture itself.
 *
 * `capture: false` is not "no history": it moves the capture to after the tags
 * are assigned, which is the only order that records them (see `genericCreate`).
 * `writeFile` is false because `upsertProjectionRow` does not act on it at all;
 * the file is written by the explicit `store.persist` after the transaction
 * commits, so a rolled-back write never leaves a file behind.
 */
const ROW_ONLY = { capture: false, writeFile: false } as const;

/**
 * Delete keeps `capture: true`, because there is nothing to interleave.
 *
 * `removeProjectionRow` captures the tombstone BEFORE the row goes — the
 * entity, tags included, is still whole at that moment — so the ordering
 * problem the create/update paths have does not arise here.
 */
const DELETE_OPTS = { capture: true, writeFile: false } as const;

/** Capture the mutation into `entity_version`, once the entity is complete. */
function capture(
  deps: GenericCrudDeps,
  type: string,
  slug: string,
  op: 'created' | 'updated' | 'noop',
  actor: ChangedBy,
): void {
  if (op === 'noop') return;
  const summary = op === 'created' ? 'Created' : 'Updated';
  deps.projection.versions?.captureEntitySnapshot(type, slug, op === 'created' ? 'create' : 'update', actor, summary);
}

/**
 * Run the row write, the tag assignment and the version capture as one unit.
 *
 * better-sqlite3 nests through SAVEPOINTs, so the transactions inside
 * `upsertProjectionRow` and `renameProjectionRow` compose with this rather than
 * conflicting with it.
 */
function inOneTransaction<T>(deps: GenericCrudDeps, fn: () => T): T {
  return deps.projection.db.transaction(fn)();
}

/**
 * The random source `slugPattern`'s `nanoid(n)` step draws from.
 *
 * Same alphabet and the same construction as the section indexer's anchors
 * (`[a-z0-9]`), because a slug and an anchor are read by the same eye and typed
 * into the same URL bar. `customAlphabet` is bound once: rebuilding it per call
 * would re-seed on every create.
 */
const slugNanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789');

function requireModule(deps: GenericCrudDeps, type: string): BackendModule {
  const module = deps.host.getEntity(type);
  if (!module) throw new DomainError('VALIDATION', `unknown entity type '${type}'`);
  if (!module.data?.schema) {
    throw new DomainError(
      'VALIDATION',
      `type '${type}' declares no data.schema — the host has nothing to write`,
    );
  }
  return module;
}

/**
 * The slug for a new entity: the caller's if it supplied one, otherwise the
 * pattern's — then either suffixed until free or refused, per the type's
 * declared `slugConflict`.
 *
 * An EXPLICIT slug always refuses. That half was never in dispute: `ac` is the
 * type tier E generalized from, and even `ac` threw `SLUG_CONFLICT` when the
 * caller named the slug. Landing somewhere other than where you were told to is
 * worse than failing, and it is the same rule a RENAME follows.
 *
 * A DERIVED slug follows the declaration, defaulting to refusing. Tier E
 * suffixed unconditionally, which made a re-`POST` of `GET /api/users` create
 * `get-api-users-2` — two entities for one route, drifting apart, with every
 * reference still pointing at the first. See `slugConflict` on the manifest for
 * why the two answers both exist.
 */
function allocateSlug(deps: GenericCrudDeps, module: BackendModule, payload: Record<string, unknown>): string {
  const explicit = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const base = explicit || evaluateSlugPattern(module.slugPattern, payload, (n) => slugNanoid(n));
  if (!base) throw new DomainError('VALIDATION', `${module.type}: slug resolves to empty`);
  if (!deps.reader.getEntity(module.type, base)) return base;

  if (explicit || (module.slugConflict ?? 'reject') === 'reject') {
    throw new DomainError('SLUG_CONFLICT', `${module.type} slug '${base}' already exists`);
  }
  let candidate = base;
  let n = 1;
  while (deps.reader.getEntity(module.type, candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export interface GenericMutateResult {
  slug: string;
  warnings?: string[];
}

/** `POST /api/{type}s` and `create_entities`, for a type with no service. */
export function genericCreate(
  deps: GenericCrudDeps,
  type: string,
  input: unknown,
  actor: ChangedBy,
): GenericMutateResult {
  const module = requireModule(deps, type);
  const supplied = { ...((input ?? {}) as Record<string, unknown>) };
  const tags = Array.isArray(supplied.tags) ? (supplied.tags as string[]) : [];

  /**
   * The slug is evaluated against the WHOLE input, the row is written from the
   * input minus the host's own two keys.
   *
   * `slugPattern` may read a `transientInput` field (`diagram.caption`), which
   * is present in the input and has no column — so the two need different
   * views of the same payload rather than one filtered copy.
   */
  const slug = allocateSlug(deps, module, supplied);
  const payload = { ...supplied };
  delete payload.slug;
  delete payload.tags;

  const warnings = inOneTransaction(deps, () => {
    const result = upsertProjectionRow(deps.projection, module, slug, payload, actor, ROW_ONLY);
    // BEFORE the capture, not after. `captureEntitySnapshot` snapshots the
    // entity as it stands, and tags are part of that snapshot — assigning them
    // afterwards records every create and every update with `tags: []`, so
    // restoring the version or diffing it in a release drops them. The six
    // services all assign then capture, inside one transaction; so does this.
    if (tags.length) deps.tags.assignTags(type as RawEntityType, slug, tags);
    capture(deps, type, slug, result.op, actor);
    return result.warnings ?? [];
  });

  deps.store.persist(type, slug);
  return warnings.length ? { slug, warnings } : { slug };
}

/**
 * Merge a PATCH body onto the entity as it stands.
 *
 * The tri-state lives here and nowhere else: a key the body does not carry
 * keeps the stored value, a key carrying `null` clears it (the generated update
 * schema has already refused `null` for a field that is not `clearable`), and a
 * key carrying a value replaces it. `hasOwnProperty` rather than
 * `!== undefined`, or an explicit `{description: undefined}` would read as
 * "clear" on one path and "no change" on the other.
 *
 * THE BASE IS `snapshotFromSchema`, NOT `RawEntity.data`, and the difference is
 * two silent data losses rather than a style preference:
 *
 *   - `hydrate` keys `data` by COLUMN name (`design_system_slug`), while the
 *     patch and `upsertProjectionRow` are both keyed by declared FIELD name
 *     (`designSystemSlug`). Merging the two together left every field whose
 *     column differs from its name absent from the upsert's payload — so an
 *     unrelated PATCH wrote it back as its default or NULL, and a `required`
 *     one made the entity unpatchable.
 *   - a value collection with `keyFields` lives in a table of its own
 *     (`endpoint.linkedDtos` → `endpoint_dto`), so it is not on the row and
 *     `hydrate` never sees it. `upsertProjectionRow` reads an absent value
 *     collection as EMPTY, so a PATCH touching only `summary` deleted every
 *     linked DTO.
 *
 * `snapshotFromSchema` already answers both: it is field-keyed by construction
 * (its own doc calls that forced rather than chosen, because it feeds the same
 * writer) and it reads table-backed collections through `readCollection`. One
 * description of "this entity as a payload", shared with restore.
 */
function mergeUpdate(
  deps: GenericCrudDeps,
  module: BackendModule,
  current: RawEntity,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(snapshotFromSchema(module, current, deps.reader) as Record<string, unknown>) };
  // `slug` and `tags` are the writer's own arguments, not fields of the type.
  delete merged.slug;
  delete merged.tags;
  for (const key of Object.keys(patch)) {
    if (key === 'slug' || key === 'tags' || key === 'newSlug') continue;
    merged[key] = patch[key];
  }
  return merged;
}

/** `PATCH /api/{type}s/:slug` and `update_entities`, for a type with no service. */
export function genericUpdate(
  deps: GenericCrudDeps,
  type: string,
  slug: string,
  input: unknown,
  actor: ChangedBy,
): GenericMutateResult {
  const module = requireModule(deps, type);
  const current = deps.reader.getEntity(type, slug);
  if (!current) throw new DomainError('NOT_FOUND', `${type} '${slug}' not found`);

  const patch = (input ?? {}) as Record<string, unknown>;
  const merged = mergeUpdate(deps, module, current, patch);
  const requested = typeof patch.newSlug === 'string' ? patch.newSlug.trim() : '';
  const target = requested && requested !== slug ? requested : slug;

  /**
   * Rename and payload write in ONE transaction.
   *
   * The order within it is rename-then-write, as tier C's keyed collections
   * need (`renameProjectionRow` repoints them through `ON UPDATE CASCADE`, and
   * capturing an `entity_version` against a slug about to stop existing would
   * be worse). What the transaction adds is that a payload rejected AFTER the
   * rename no longer leaves the entity moved: the first version of this
   * answered `400 VALIDATION` while the row had already changed slug, the file
   * still sat at the old one, and the next rebuild resurrected it as a second
   * entity.
   */
  const warnings = inOneTransaction(deps, () => {
    if (target !== slug) renameProjectionRow(deps.projection, module, slug, target, actor, ROW_ONLY);
    const result = upsertProjectionRow(deps.projection, module, target, merged, actor, ROW_ONLY);
    if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
      deps.tags.assignTags(type as RawEntityType, target, Array.isArray(patch.tags) ? (patch.tags as string[]) : []);
    }
    capture(deps, type, target, result.op, actor);
    return result.warnings ?? [];
  });

  if (target !== slug) deps.store.remove(type, slug);
  deps.store.persist(type, target);
  return warnings.length ? { slug: target, warnings } : { slug: target };
}

/** `DELETE /api/{type}s/:slug` and `delete_entities`, for a type with no service. */
export function genericDelete(
  deps: GenericCrudDeps,
  type: string,
  slug: string,
  actor: ChangedBy,
): { deleted: boolean } {
  const module = requireModule(deps, type);
  const result = removeProjectionRow(deps.projection, module, slug, actor, DELETE_OPTS);
  if (result.deleted) deps.store.remove(type, slug);
  return result;
}

/**
 * Repoint every markdown reference after a rename.
 *
 * Separate from `genericUpdate` because it is async and the write is not: the
 * two REST/MCP callers already await it in exactly this position, and folding
 * it in would make every synchronous write path await a filesystem walk.
 */
export async function propagateRename(
  deps: GenericCrudDeps,
  type: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  if (oldSlug === newSlug) return;
  await deps.references.propagateSlugChange(type as RawEntityType, oldSlug, newSlug);
}
