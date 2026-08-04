/**
 * M39 — what `search_entities` actually looks at. Since 0.2.4: TWO layers.
 *
 * 1. **core** (default, always present, THE ONLY SOURCE OF SCOPE) — every text
 *    path in the type's `data.schema`.
 * 2. **agent** (explicit, per call) — the `fields` parameter, the only override.
 *
 * Both type-side layers are gone as of 0.2.4: `backend.crud.searchableFields`
 * (declarative narrowing) and `EntityCrudService.search?` (a per-type ranking
 * implementation). They were removed together rather than one at a time,
 * because leaving either would let the same type rank differently depending on
 * which MCP tool asked. Neither had a single producer across the host repo, the
 * preinstalled envelope, or external packages — the only occurrence was a test
 * fixture.
 *
 * 2.0.0 (brief item 26) moved the DERIVATION off `backend.crud.createSchema`
 * onto `data.schema`. Same two layers, one less indirection: the scope used to
 * be read out of a Zod shape via `z.toJSONSchema`, which meant search covered
 * whatever the CRUD INPUT happened to accept rather than what the type stores,
 * and it disappears entirely once a type stops shipping a `crud` slot. Two
 * limits the old route documented as known gaps close with the move:
 *
 *   - a `record<K,V>` branch is no longer skipped. It renders as `$key`/`$value`
 *     segments, which `valuesAtPath` resolves — `design-system` keeps every
 *     token value it holds out of search otherwise, and `dto` its examples.
 *   - the depth cut is `MAX_PROJECTION_DEPTH`, the same constant registration
 *     validation enforces, instead of a private 4 that happened to agree with it.
 *
 * Whatever wins, the resolved list travels back in `searchedFields`. Without it
 * an empty result is indistinguishable from "you searched a field that isn't in
 * scope", and the agent cannot tell a real absence from its own mistake.
 *
 * HARD REQUIREMENT: the scope is non-empty for every active type. If derivation
 * yields nothing, the fix is to the DERIVATION (see `hostDefaultFields`'s
 * identity fallback), never a restored declaration layer.
 *
 * Path notation is dotted, with `[]` for collections and `$key`/`$value` for a
 * record's two halves: `fields[].description`, `columns[].name`,
 * `verifies[].slug`, `groups[].tokens[].value.$value`.
 */

import {
  MAX_PROJECTION_DEPTH,
  columnOf,
  hasProjectionTable,
  type DataDeclaration,
  type FieldNode,
} from '../../../shared/plugin-host/data-schema.js';
import type { BackendModule } from '../../core/plugin-host/types.js';

export interface SearchableField {
  path: string;
  weight?: number;
}

/** Identity paths every type has, whatever its schema says. */
const IDENTITY_PATHS: SearchableField[] = [
  { path: 'slug', weight: 3 },
  { path: 'name', weight: 3 },
  { path: 'label', weight: 3 },
  { path: 'title', weight: 3 },
];

/**
 * Resolves the two layers into the concrete list a call will search.
 * `requested` is taken as authored — a path that does not exist in the schema
 * is NOT dropped here, because silently repairing a caller's field list is how
 * `searchedFields` would start lying.
 */
export function resolveSearchFields(
  module: BackendModule | null,
  requested: readonly string[] | undefined,
): SearchableField[] {
  if (requested?.length) return requested.map((path) => ({ path }));
  return hostDefaultFields(module);
}

/**
 * The core default — since 0.2.4 the ONLY source of scope: the text leaves of
 * the type's `data.schema`, plus the identity paths. Derived from the same
 * declaration the projection, the snapshot and `describe_entity_type`'s JSON
 * Schemas come from, so what search covers and what the type advertises cannot
 * drift apart.
 *
 * Guaranteed non-empty. A type whose schema derives no text path at all (a
 * throwing getter, a declaration with only numeric leaves, no declaration) still
 * gets `slug` plus whichever identity paths it declares — because "this type has
 * no searchable scope" is not a state any active type may be in, and the
 * alternative to a fallback here is a type that silently answers every query
 * with nothing.
 */
export function hostDefaultFields(module: BackendModule | null): SearchableField[] {
  // Reading the slot is itself guarded: a manifest can expose `data` as a
  // getter, and a throwing one must degrade THIS list, not the caller's whole
  // answer. `describe_entity_type` is built to isolate a broken type into a
  // per-field placeholder, and an unguarded read here would escalate that back
  // into a whole-entry failure.
  let schema: DataDeclaration['schema'] | undefined;
  try {
    schema = module?.data?.schema;
  } catch {
    schema = undefined;
  }
  const derived = schema ? textPathsOfSchema(schema) : [];
  const seen = new Set(derived.map((f) => f.path));
  const out = [...derived];
  for (const id of IDENTITY_PATHS) {
    if (!seen.has(id.path)) continue;
    // Identity paths only get their boost when the schema actually has them;
    // inventing a `title` that no type declares would make `searchedFields`
    // advertise a field that cannot ever match.
    out[out.findIndex((f) => f.path === id.path)] = id;
  }
  // 0.2.4 — the non-empty guarantee, and it is `slug` ALONE among the IDENTITY
  // paths. Every entity has a slug (it is the identity column), so this is the
  // one identity path that can be added unconditionally without breaking the
  // rule stated just above: a field in `searchedFields` must be one that can
  // actually match. Padding a schema-less type with a guessed `name` would
  // reintroduce exactly the ambiguity `searchedFields` exists to remove — an
  // empty result on a field the type never had, which an agent reads as "not in
  // the specification".
  if (!seen.has('slug')) out.unshift({ path: 'slug', weight: 3 });
  /**
   * 2.0.0 — `tags[]` is added by the HOST, for every type, unconditionally.
   *
   * Tags are a cross-cutting layer (M18, `entity_tag`): no `data.schema` declares
   * them, and every entity can carry them. That is why moving the derivation off
   * `createSchema` silently dropped them — each core `createSchema` listed
   * `tags: z.array(z.string())` by hand, so the old route picked them up as an
   * ordinary schema field, and the new one has no field to find. `searchEntities`
   * still builds its record as `{ ...data, slug, tags }`, so without this line
   * that key is simply dead and an AC tagged `billing` stops answering a
   * `billing` query.
   */
  if (!seen.has('tags[]')) out.push({ path: 'tags[]' });
  return out;
}

/**
 * Every text path a declaration holds THAT A SEARCH CAN ACTUALLY REACH.
 *
 * Emits `string` and `enum` leaves — an enum is a closed set of strings and a
 * user searching "deprecated" means the `status` that says so.
 *
 * Everything else here is about the one rule this module cannot break: a path in
 * `searchedFields` must be a path that can match. The record a search resolves
 * against is `{ ...RawEntity.data, slug, tags }`, and `RawEntity.data` is the
 * entity ROW — so what is reachable is decided by the projection, not by the
 * declaration alone:
 *
 *   - **The first segment is the COLUMN name**, because `hydrate` copies the row
 *     verbatim. `ui-view` declares `designSystemSlug` and stores
 *     `design_system_slug`; emitting the payload name advertises a path that
 *     resolves to nothing. Segments BELOW the first stay payload names — they
 *     address JSON content, which the snapshot writes under declared names.
 *   - **A collection with its own projection table is skipped entirely.** Its
 *     rows live in another table and never reach `data`; `endpoint.linkedDtos`
 *     would otherwise advertise `linkedDtos[].dto` on a record where that key is
 *     permanently `undefined`.
 *   - **`transientInput` / `localSurrogate`** are not in the index at all.
 *   - **`systemManaged`** is `createdAt`/`updatedAt`: every type has two, and a
 *     free-text query over an ISO timestamp is noise.
 *
 * The last three are excluded by PREFIX, so an object marked transient cannot
 * leak its children back in.
 */
function textPathsOfSchema(schema: DataDeclaration['schema']): SearchableField[] {
  const out: SearchableField[] = [];
  const push = (path: string): void => {
    if (!out.some((f) => f.path === path)) out.push({ path });
  };

  const visit = (node: FieldNode, path: string, depth: number): void => {
    if (depth > MAX_PROJECTION_DEPTH) return;
    if (node.transientInput || node.localSurrogate || node.systemManaged) return;
    if (node.kind === 'string' || node.kind === 'enum') {
      push(path);
      return;
    }
    if (node.kind === 'object') {
      for (const [name, child] of Object.entries(node.fields)) visit(child, `${path}.${name}`, depth + 1);
      return;
    }
    if (node.kind === 'collection') {
      // Its rows are in a table of their own; `data` never carries them.
      if (hasProjectionTable(node)) return;
      // The item is the collection's own level, not one below it — the same rule
      // `walkSchema` applies, so a schema that projects cannot fail to search.
      visit(node.item, `${path}[]`, depth);
      return;
    }
    if (node.kind === 'record') {
      visit(node.key, `${path}.$key`, depth + 1);
      visit(node.value, `${path}.$value`, depth + 1);
    }
  };

  try {
    for (const [name, node] of Object.entries(schema)) {
      // Top level only: the row's column name is what `hydrate` produced.
      visit(node, columnOf(name, node), 0);
    }
  } catch {
    // A declaration that will not walk (a getter that throws mid-traversal) must
    // not take the whole search down — the identity paths still work.
    return [];
  }
  return out;
}

/**
 * Every string value a path selects. Returns an empty array for a path that
 * does not exist — which is exactly what makes the "wrong field name" case
 * observable: no values, but `searchedFields` still says what was looked at.
 *
 * Understands the four segment forms the derivation emits: `field`, `field[]`,
 * and the record halves `$key` / `$value`. The record forms are 2.0.0 — a
 * `record<K,V>` used to be skipped by the derivation, so no path ever reached
 * here needing them, and a `design-system`'s token values were unsearchable.
 */
export function valuesAtPath(record: Record<string, unknown>, path: string): string[] {
  let current: unknown[] = [record];
  for (const segment of path.split('.')) {
    const next: unknown[] = [];
    if (segment === '$key' || segment === '$value') {
      for (const node of current) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
        const entries = node as Record<string, unknown>;
        next.push(...(segment === '$key' ? Object.keys(entries) : Object.values(entries)));
      }
      current = next;
      continue;
    }
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;
    for (const node of current) {
      if (!node || typeof node !== 'object') continue;
      const value = (node as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (isArray) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }
    current = next;
  }
  return current.filter((v): v is string => typeof v === 'string');
}
