/**
 * M39 — what `search_entities` actually looks at, in three layers.
 *
 * Precedence is **agent > type > host**:
 *
 * 1. **host** (default, always present) — every text path derivable from the
 *    type's `createSchema`. No declaration is needed for a type to be
 *    searchable, which is the whole point: before this, "searchable" meant "the
 *    service implements the optional `search` method", and exactly one type in
 *    the repo did. Search covered 1/8 types while claiming to cover the spec.
 * 2. **type** (declarative, optional) — `backend.crud.searchableFields`, DATA on
 *    the manifest rather than code: a list of paths with optional weights. A
 *    type uses it to NARROW and to rank, never to opt out.
 * 3. **agent** (explicit, per call) — the `fields` parameter overrides both.
 *
 * Whatever wins, the resolved list travels back in `searchedFields`. Without it
 * an empty result is indistinguishable from "you searched a field that isn't in
 * scope", and the agent cannot tell a real absence from its own mistake.
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
 * Resolves the three layers into the concrete list a call will search.
 * `declared` and `requested` are taken as authored — a path that does not exist
 * in the schema is NOT dropped here, because silently repairing a caller's
 * field list is how `searchedFields` would start lying.
 */
export function resolveSearchFields(
  module: BackendModule | null,
  requested: readonly string[] | undefined,
): SearchableField[] {
  if (requested?.length) return requested.map((path) => ({ path }));
  let declared: Array<{ path: string; weight?: number }> | undefined;
  try {
    declared = module?.backend?.crud?.searchableFields;
  } catch {
    declared = undefined;
  }
  if (declared?.length) return declared.map((f) => ({ path: f.path, weight: f.weight }));
  return hostDefaultFields(module);
}

/** Whether the type NARROWED the host default with its own declaration. */
export function hasDeclaredSearchFields(module: BackendModule | null): boolean {
  try {
    return (module?.backend?.crud?.searchableFields?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * The host default: string-typed leaves of the type's create schema, plus the
 * identity paths. Derived through `z.toJSONSchema`, which is the same route
 * `describe_entity_type` already takes, so what search covers and what the
 * schema advertises cannot drift apart.
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
