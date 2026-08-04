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
 *     ("staged data, not yet the live rule"). For a type WITH a service that is
 *     still true; for one without, this is the rule.
 *   - merge the tri-state update onto the current payload. The projection
 *     upsert names every column unconditionally, so handing it a PATCH body
 *     would blank every field the caller did not mention.
 *   - assign tags, persist the entity file, and drop the old file on a rename.
 *
 * WHY IT PREFERS A SERVICE. `HostEntityWriter` follows the same order and for
 * the same reason (see its `upsert`): a service carries domain validation and
 * derived fields the declaration does not describe, so bypassing one that
 * exists would write a row that type would never have written. Tier K deletes
 * the six services; until then this is the door for everything else, and the
 * `serviceless` branch is the one the plug-and-play test (item 63) exercises.
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

/** A real mutation from a user or an agent: capture a version, write the file. */
const MUTATE = { capture: true, writeFile: true } as const;

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
 * pattern's, in both cases suffixed until it is free.
 *
 * The suffix is applied to an EXPLICIT slug too — that is what the retired
 * `crud-schemas.ts` files documented ("collisions get a -2/-3 suffix") and what
 * every `allocateSlug` did. A create that collides is therefore never an error
 * here; `SLUG_CONFLICT` is reserved for a RENAME, where the caller named a
 * target and silently landing somewhere else would be worse than failing.
 */
function allocateSlug(deps: GenericCrudDeps, module: BackendModule, payload: Record<string, unknown>): string {
  const explicit = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const base = explicit || evaluateSlugPattern(module.slugPattern, payload, (n) => slugNanoid(n));
  if (!base) throw new DomainError('VALIDATION', `${module.type}: slug resolves to empty`);
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

  const result = upsertProjectionRow(deps.projection, module, slug, payload, actor, MUTATE);
  if (tags.length) deps.tags.assignTags(type as RawEntityType, slug, tags);
  deps.store.persist(type, slug);
  return result.warnings?.length ? { slug, warnings: result.warnings } : { slug };
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
 */
function mergeUpdate(current: RawEntity, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...current.data };
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
  const merged = mergeUpdate(current, patch);

  /**
   * Rename FIRST, then write the payload against the new slug.
   *
   * `renameProjectionRow` moves the row and everything keyed off it (tier C's
   * keyed collections repoint through `ON UPDATE CASCADE`) in one transaction.
   * Doing it the other way — write, then rename — would capture an
   * `entity_version` against a slug that is about to stop existing.
   */
  const requested = typeof patch.newSlug === 'string' ? patch.newSlug.trim() : '';
  let target = slug;
  if (requested && requested !== slug) {
    renameProjectionRow(deps.projection, module, slug, requested, actor, MUTATE);
    target = requested;
  }

  const result = upsertProjectionRow(deps.projection, module, target, merged, actor, MUTATE);
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
    deps.tags.assignTags(type as RawEntityType, target, Array.isArray(patch.tags) ? (patch.tags as string[]) : []);
  }
  if (target !== slug) deps.store.remove(type, slug);
  deps.store.persist(type, target);
  return result.warnings?.length ? { slug: target, warnings: result.warnings } : { slug: target };
}

/** `DELETE /api/{type}s/:slug` and `delete_entities`, for a type with no service. */
export function genericDelete(
  deps: GenericCrudDeps,
  type: string,
  slug: string,
  actor: ChangedBy,
): { deleted: boolean } {
  const module = requireModule(deps, type);
  const result = removeProjectionRow(deps.projection, module, slug, actor, MUTATE);
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
