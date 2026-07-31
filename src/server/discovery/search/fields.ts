/**
 * M39 — what `search_entities` actually looks at. Since 0.2.4: TWO layers.
 *
 * 1. **core** (default, always present, THE ONLY SOURCE OF SCOPE) — every text
 *    path derivable from the type's `backend.crud.createSchema`.
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
 * Whatever wins, the resolved list travels back in `searchedFields`. Without it
 * an empty result is indistinguishable from "you searched a field that isn't in
 * scope", and the agent cannot tell a real absence from its own mistake.
 *
 * HARD REQUIREMENT: the scope is non-empty for every active type. If derivation
 * yields nothing, the fix is to the DERIVATION (see `hostDefaultFields`'s
 * identity fallback), never a restored declaration layer.
 *
 * Documented limits — recorded, not bugs:
 *   - map/record schema branches without declared `properties` are skipped
 *     silently; there are no known paths under them to enumerate.
 *   - recursion into nested schemas stops at depth 4 with no signal.
 *
 * Path notation is dotted with `[]` for arrays: `fields[].description`,
 * `columns[].name`, `verifies[].slug`.
 */

import { z, type ZodRawShape } from 'zod';
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
 * The core default — since 0.2.4 the ONLY source of scope: string-typed leaves
 * of the type's create schema, plus the identity paths. Derived through
 * `z.toJSONSchema`, the same route `describe_entity_type` takes, so what search
 * covers and what the schema advertises cannot drift apart.
 *
 * Guaranteed non-empty. A type whose schema derives no text path at all (a
 * throwing getter, a schema that will not render, a shape with only numeric
 * leaves) still gets `slug` plus whichever identity paths it declares — because
 * "this type has no searchable scope" is not a state any active type may be in,
 * and the alternative to a fallback here is a type that silently answers every
 * query with nothing.
 */
export function hostDefaultFields(module: BackendModule | null): SearchableField[] {
  // Reading the slot is itself guarded: a manifest can expose `createSchema` as
  // a getter, and a throwing one must degrade THIS list, not the caller's whole
  // answer. `describe_entity_type` is built to isolate a broken type into a
  // per-field placeholder, and an unguarded read here would escalate that back
  // into a whole-entry failure.
  let shape: ZodRawShape | undefined;
  try {
    shape = module?.backend?.crud?.createSchema;
  } catch {
    shape = undefined;
  }
  const derived = shape ? textPathsOfShape(shape) : [];
  const seen = new Set(derived.map((f) => f.path));
  const out = [...derived];
  for (const id of IDENTITY_PATHS) {
    if (!seen.has(id.path)) continue;
    // Identity paths only get their boost when the schema actually has them;
    // inventing a `title` that no type declares would make `searchedFields`
    // advertise a field that cannot ever match.
    out[out.findIndex((f) => f.path === id.path)] = id;
  }
  if (!seen.has('slug')) out.unshift({ path: 'slug', weight: 3 });
  // 0.2.4 — the non-empty guarantee. Reached only when derivation produced
  // nothing at all, i.e. the schema is absent or unrenderable. There `name` is
  // no longer an invented field: the record search reads is the entity's stored
  // data, which carries one far more often than a broken schema can say so, and
  // scoping a type down to its slug alone is barely searchable.
  if (derived.length === 0 && !out.some((f) => f.path === 'name')) {
    out.push({ path: 'name', weight: 3 });
  }
  return out;
}

function textPathsOfShape(shape: ZodRawShape): SearchableField[] {
  let json: unknown;
  try {
    json = z.toJSONSchema(z.object(shape), { io: 'input', unrepresentable: 'any' });
  } catch {
    // A schema that will not render (a custom refinement, a BigInt default) must
    // not take the whole search down — the identity paths still work.
    return [];
  }
  const out: SearchableField[] = [];
  collect(json, '', out, 0);
  return out;
}

const MAX_DEPTH = 4;

function collect(node: unknown, prefix: string, out: SearchableField[], depth: number): void {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return;
  const schema = node as Record<string, unknown>;

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branch = schema[key];
    if (Array.isArray(branch)) {
      for (const b of branch) collect(b, prefix, out, depth);
      return;
    }
  }

  const type = schema.type;
  if (type === 'string' && prefix) {
    if (!out.some((f) => f.path === prefix)) out.push({ path: prefix });
    return;
  }
  if (type === 'array') {
    collect(schema.items, `${prefix}[]`, out, depth + 1);
    return;
  }
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) return;
  for (const [key, child] of Object.entries(properties)) {
    collect(child, prefix ? `${prefix}.${key}` : key, out, depth + 1);
  }
}

/**
 * Every string value a path selects. Returns an empty array for a path that
 * does not exist — which is exactly what makes the "wrong field name" case
 * observable: no values, but `searchedFields` still says what was looked at.
 */
export function valuesAtPath(record: Record<string, unknown>, path: string): string[] {
  let current: unknown[] = [record];
  for (const segment of path.split('.')) {
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
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
