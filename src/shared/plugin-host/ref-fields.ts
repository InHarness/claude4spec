/**
 * 2.1.41 (M13) — THE walk over a `data.schema` that decides which `ref` flags
 * are references.
 *
 * A `ref: '<type>'` flag counts in exactly two places:
 *
 *   1. a scalar field at the top level of `data` (`ui-view.designSystemSlug`);
 *   2. a scalar field of an object that is an element of a VALUE collection
 *      (`endpoint.linkedDtos[].dto`, `ui-kit-component.composes[].component`),
 *      including a scalar of an object nested inside such an element
 *      (`database-table.columns[].fk.table`).
 *
 * Everywhere else — an object nested outside any collection, a scalar element
 * of a collection (`string[]` with `ref` on the item), a `record<K,V>` node, a
 * keyed collection — the flag is MISPLACED: the type still registers, the
 * registration reports a warning (server log and `c4s plugins doctor`), and the
 * field is not a reference for anybody. Validation of a write, rename
 * propagation and the UI's `refLookup` all read this one walk, which is what
 * keeps the three from disagreeing about what a reference is.
 *
 * `ref: '$type'` is NOT a `ref: <type>` field. It is the polymorphic exception
 * of `ac.verifies[]` (`{ type, slug }`, the type checks its own targets): the
 * walk reports it separately, as `polymorphic`, so rename propagation can keep
 * repointing it while `refLookup` never resolves it, and it never produces a
 * placement warning in an allowed place.
 *
 * Pure data, no imports outside `shared/`: the server (registration, write
 * path, rename) and the browser (`useRefLookup`) both run it.
 */

import { collectionKindOf, type FieldNode } from './data-schema.js';

/** The four positions a `ref` flag may not take. */
export type RefPlacementIssue = 'nested-object' | 'scalar-item' | 'record' | 'keyed-collection';

/** One `ref`-flagged node, with the dotted payload path carrying it (`columns[].fk.table`). */
export interface RefFieldSite {
  path: string;
  node: FieldNode;
  /** The flag's value: a type name from the type registry, or `'$type'`. */
  target: string;
}

export interface MisplacedRefField extends RefFieldSite {
  issue: RefPlacementIssue;
}

export interface RefFieldWalk {
  /** `ref: '<type>'` in an allowed place — the references. */
  refs: readonly RefFieldSite[];
  /** `ref: '$type'` in an allowed place — the polymorphic exception (`ac.verifies[].slug`). */
  polymorphic: readonly RefFieldSite[];
  /** A flag in a forbidden place: reported, never honoured. */
  misplaced: readonly MisplacedRefField[];
}

/** The marker a polymorphic ref carries instead of a type name. */
export const POLYMORPHIC_REF = '$type';

/** Human-readable reason per issue, for the registration warning. */
export const REF_PLACEMENT_REASONS: Readonly<Record<RefPlacementIssue, string>> = {
  'nested-object': 'an object nested outside a collection',
  'scalar-item': 'a scalar element of a collection',
  record: 'a record<K,V> node',
  'keyed-collection': 'a keyed collection',
};

/**
 * Where the walk currently stands. `top` and `item` are the two allowed
 * contexts; the other four are the forbidden positions, and a context, once
 * forbidden, stays forbidden for the whole subtree below it.
 */
type Context = 'top' | 'item' | RefPlacementIssue;

const isScalar = (node: FieldNode): boolean =>
  node.type === 'string' || node.type === 'number' || node.type === 'boolean' || node.type === 'enum';

const allowed = (ctx: Context): boolean => ctx === 'top' || ctx === 'item';

const memo = new WeakMap<object, RefFieldWalk>();

/**
 * Walk a schema once and sort every `ref` flag into references, polymorphic
 * refs and misplaced flags. Memoised per schema object — a type's declaration
 * is immutable once registered, and the browser runs this per list render.
 */
export function collectRefFields(schema: Readonly<Record<string, FieldNode>> | undefined): RefFieldWalk {
  if (!schema) return { refs: [], polymorphic: [], misplaced: [] };
  const cached = memo.get(schema);
  if (cached) return cached;

  const refs: RefFieldSite[] = [];
  const polymorphic: RefFieldSite[] = [];
  const misplaced: MisplacedRefField[] = [];

  const visitFlag = (path: string, node: FieldNode, ctx: Context): void => {
    if (!node.ref) return;
    const site: RefFieldSite = { path, node, target: node.ref };
    if (allowed(ctx) && isScalar(node)) {
      (node.ref === POLYMORPHIC_REF ? polymorphic : refs).push(site);
      return;
    }
    // A `ref` on a container is never a slug; report it under the position it sits in,
    // or as an object nested outside a collection when that position is itself allowed.
    misplaced.push({ ...site, issue: ctx === 'top' || ctx === 'item' ? 'nested-object' : ctx });
  };

  const walkNode = (path: string, node: FieldNode, ctx: Context): void => {
    visitFlag(path, node, ctx);
    if (node.type === 'object') {
      // An object at the top level is "nested outside a collection"; inside a
      // collection element it stays part of that element.
      const inner: Context = ctx === 'top' ? 'nested-object' : ctx;
      for (const [name, child] of Object.entries(node.fields)) walkNode(`${path}.${name}`, child, inner);
      return;
    }
    if (node.type === 'collection') {
      const itemPath = `${path}[]`;
      if (collectionKindOf(node) === 'keyed') {
        walkNode(itemPath, node.item, allowed(ctx) ? 'keyed-collection' : ctx);
        return;
      }
      if (node.item.type === 'object') {
        // A value collection's element is position 2 wherever the collection
        // itself sits, unless a forbidden context above already claimed it.
        const inner: Context = ctx === 'record' || ctx === 'keyed-collection' ? ctx : 'item';
        for (const [name, child] of Object.entries(node.item.fields)) walkNode(`${itemPath}.${name}`, child, inner);
        visitFlag(itemPath, node.item, ctx === 'top' || ctx === 'item' ? 'nested-object' : ctx);
        return;
      }
      walkNode(itemPath, node.item, allowed(ctx) || ctx === 'nested-object' ? 'scalar-item' : ctx);
      return;
    }
    if (node.type === 'record') {
      const inner: Context = allowed(ctx) || ctx === 'nested-object' ? 'record' : ctx;
      walkNode(`${path}.$key`, node.key, inner);
      walkNode(`${path}.$value`, node.value, inner);
    }
  };

  for (const [name, node] of Object.entries(schema)) walkNode(name, node, 'top');

  const walk: RefFieldWalk = { refs, polymorphic, misplaced };
  memo.set(schema, walk);
  return walk;
}

/**
 * The nodes whose `ref` flag the host honours — references plus the polymorphic
 * exception. Rename propagation and write validation recurse by node, not by
 * path, and test membership here before acting on a flag.
 */
export function honouredRefNodes(schema: Readonly<Record<string, FieldNode>> | undefined): ReadonlySet<FieldNode> {
  if (!schema) return EMPTY_NODES;
  const cached = honouredMemo.get(schema);
  if (cached) return cached;
  const walk = collectRefFields(schema);
  const set = new Set<FieldNode>([...walk.refs, ...walk.polymorphic].map((s) => s.node));
  honouredMemo.set(schema, set);
  return set;
}

const EMPTY_NODES: ReadonlySet<FieldNode> = new Set();
const honouredMemo = new WeakMap<object, ReadonlySet<FieldNode>>();

/** One resolved value of a `ref: '<type>'` field: the target record's coordinates. */
export interface RefTarget {
  type: string;
  slug: string;
}

/** `${type}:${slug}` — the key of a `refLookup` map. */
export const refLookupKey = (type: string, slug: string): string => `${type}:${slug}`;

/**
 * Every `(targetType, slug)` pair the given entities hold in their reference
 * fields, without duplicates, in first-seen order. Polymorphic refs are not
 * included — `ac.verifies[]` resolves its own targets.
 */
export function refTargetsOf(
  schema: Readonly<Record<string, FieldNode>> | undefined,
  entities: readonly unknown[],
): RefTarget[] {
  const { refs } = collectRefFields(schema);
  if (!refs.length || !entities.length) return [];
  const seen = new Set<string>();
  const out: RefTarget[] = [];
  for (const entity of entities) {
    for (const site of refs) {
      for (const value of valuesAt(entity, site.path.split('.'))) {
        if (typeof value !== 'string' || !value) continue;
        const key = refLookupKey(site.target, value);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: site.target, slug: value });
      }
    }
  }
  return out;
}

/** The values a dotted walk path (`columns[].fk.table`) reaches in one payload. */
function valuesAt(value: unknown, segments: readonly string[]): unknown[] {
  if (!segments.length) return [value];
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return [];
  const [head, ...rest] = segments as [string, ...string[]];
  const isItem = head.endsWith('[]');
  const next = (value as Record<string, unknown>)[isItem ? head.slice(0, -2) : head];
  if (!isItem) return valuesAt(next, rest);
  if (!Array.isArray(next)) return [];
  return next.flatMap((item) => valuesAt(item, rest));
}
