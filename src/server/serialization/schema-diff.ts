/**
 * The semantic delta, GENERATED from the type's logical schema (0.2.31).
 *
 * This file is what replaced the `diff?` slot. Five types used to hand-write a
 * diff and each invented its own vocabulary for the result — `verify_added`,
 * `dto_added`, `param_modified`, `token_modified`, `mockup_changed`, plus a
 * `field_changes` array here and a `meta_changes` array there. Nothing could
 * consume them without knowing which type it was looking at, so the release
 * formatter reverse-engineered the shapes from a suffix convention on the key
 * names. A sixth type wrote no diff at all and got a JSON deep-diff, which is
 * to say the system had two diff modes and no contract.
 *
 * It has one now. The dictionary is closed (`DiffOp`, in `shared/`), the paths
 * are schema paths, and the only thing a type declares is what makes one element
 * of a collection the SAME element across two captures — `identity`.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   - a deep-diff fallback. A type that declares no `identity` is not a type the
 *     host failed to understand; it is a type that said its element order is
 *     meaningful. It gets index matching, and reordering is a change.
 *   - a `noop` shortcut that compares JSON. `noop` is STRUCTURAL: it is what
 *     "no operations were produced" is called. That is what makes a pure
 *     reshuffle of an identity-declared collection read as `noop` for free
 *     rather than by a rule someone has to remember.
 *   - any mention of an entity type. If a branch in this file ever needs to know
 *     whether it is diffing an `ac` or a `dto`, the declaration is missing
 *     something and THAT is the thing to fix.
 */

import {
  collectionKindOf,
  contentBytes,
  identityOf,
  rekeyOnOf,
  type CollectionNode,
  type DiffOp,
  type FieldNode,
  type IdentityKey,
} from '../../shared/plugin-host/data-schema.js';

type Row = Record<string, unknown>;

/** Two snapshots' `tags`, as the only two operations that carry no `path`. */
function diffTags(a: unknown, b: unknown): DiffOp[] {
  const from = Array.isArray(a) ? (a as unknown[]).map(String) : [];
  const to = Array.isArray(b) ? (b as unknown[]).map(String) : [];
  const fromSet = new Set(from);
  const toSet = new Set(to);
  /**
   * SORTED, and emitted after the field operations by the caller.
   *
   * The snapshot has a byte-identity invariant — two captures of an unchanged
   * entity are identical — and a delta that reorders itself run to run would
   * undo that guarantee one layer up, where the deltas themselves are compared.
   */
  const out: DiffOp[] = [];
  for (const tag of [...toSet].filter((t) => !fromSet.has(t)).sort()) {
    out.push({ op: 'tag_added', tag });
  }
  for (const tag of [...fromSet].filter((t) => !toSet.has(t)).sort()) {
    out.push({ op: 'tag_removed', tag });
  }
  return out;
}

/**
 * Is this field's value opaque — reported by SIZE rather than by value?
 *
 * Two sources, deliberately collapsed into one operation. `contentBearing` is
 * the declared case (a document body, a mockup). A `json` node is the derived
 * one: it is the escape hatch for values the schema does not constrain
 * (`design-system` token values, `dto.examples[].value`), so there is no
 * structure to walk and a `from`/`to` pair would be two blobs side by side.
 */
function isOpaque(node: FieldNode): boolean {
  return !!node.contentBearing || node.type === 'json';
}

function opaqueChange(path: string, a: unknown, b: unknown): DiffOp | null {
  // Compared by VALUE, reported by SIZE: two different bodies that happen to be
  // the same length are still a change, and reporting `12 → 12` is more honest
  // than staying silent about it.
  if (jsonEqual(a, b)) return null;
  return { op: 'field_changed_opaque', path, fromBytes: contentBytes(a), toBytes: contentBytes(b) };
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The identity tuple of one item, as the delta reports it. */
function identityKeyOf(item: unknown, fields: readonly string[]): IdentityKey {
  const out: IdentityKey = {};
  const row = (item ?? {}) as Row;
  for (const name of fields) {
    const value = row[name];
    out[name] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : String(value ?? '');
  }
  return out;
}

/** A stable string form of an identity tuple, for map keys. NUL-joined so a
 *  value containing the separator cannot forge a neighbour's key. */
function keyOf(item: unknown, fields: readonly string[]): string {
  const row = (item ?? {}) as Row;
  return fields.map((name) => String(row[name] ?? '')).join('\u0000');
}

/** The fields of a collection's item, or `null` when the item is a scalar. */
function itemFieldsOf(node: CollectionNode): Readonly<Record<string, FieldNode>> | null {
  return node.item.type === 'object' ? node.item.fields : null;
}

/**
 * Match a value collection's elements BY INDEX — what a collection with no
 * declared identity gets.
 *
 * Not a degradation and not a fallback: `database-table.columns` means it. The
 * order of a table's columns is part of the table, so swapping two of them is a
 * change to both positions, and that is exactly what index matching reports.
 */
function diffByIndex(path: string, node: CollectionNode, a: unknown[], b: unknown[]): DiffOp[] {
  const out: DiffOp[] = [];
  const fields = itemFieldsOf(node);
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    const identity: IdentityKey = { index: i };
    if (i >= a.length) {
      out.push({ op: 'item_added', path, identity, item: right });
      continue;
    }
    if (i >= b.length) {
      out.push({ op: 'item_removed', path, identity, item: left });
      continue;
    }
    const changes = fields
      ? diffFields(fields, left as Row, right as Row, `${path}[]`)
      : scalarItemChanges(node, `${path}[]`, left, right);
    if (changes.length) out.push({ op: 'item_modified', path, identity, changes });
  }
  return out;
}

/** A collection of scalars has no field names, so its item IS the value. */
function scalarItemChanges(node: CollectionNode, path: string, a: unknown, b: unknown): DiffOp[] {
  if (jsonEqual(a, b)) return [];
  if (isOpaque(node.item)) {
    return [{ op: 'field_changed_opaque', path, fromBytes: contentBytes(a), toBytes: contentBytes(b) }];
  }
  return [{ op: 'field_changed', path, from: a, to: b }];
}

/**
 * The two-pass match for a collection that declared an identity.
 *
 * Pass 1 pairs on the FULL key: a pair with differences is `item_modified`, an
 * identical pair produces nothing (which is what makes a reshuffle `noop`).
 *
 * Pass 2 exists so that editing a key field reads as a MOVE rather than as a
 * deletion and an unrelated arrival. It runs only over what pass 1 left
 * unmatched, and only on `rekeyOn` — a proper prefix of the identity, so it is
 * strictly coarser than pass 1 and cannot re-pair what pass 1 already settled.
 *
 * AMBIGUITY DEGRADES SILENTLY, and that is the deliberate part. If two orphans
 * on either side share a `rekeyOn` key, there is no fact about which moved into
 * which; the honest report is the remove/add pair, and a warning about it would
 * be a warning about the data being ordinary.
 */
function diffByIdentity(
  path: string,
  node: CollectionNode,
  a: unknown[],
  b: unknown[],
  identity: readonly string[],
): DiffOp[] {
  const out: DiffOp[] = [];
  const fields = itemFieldsOf(node);

  const leftByKey = new Map<string, unknown>();
  for (const item of a) leftByKey.set(keyOf(item, identity), item);
  const matchedLeft = new Set<string>();

  const orphansRight: unknown[] = [];
  for (const right of b) {
    const key = keyOf(right, identity);
    const left = leftByKey.get(key);
    if (left === undefined && !leftByKey.has(key)) {
      orphansRight.push(right);
      continue;
    }
    matchedLeft.add(key);
    const changes = fields
      ? diffFields(fields, left as Row, right as Row, `${path}[]`)
      : scalarItemChanges(node, `${path}[]`, left, right);
    if (changes.length) {
      out.push({ op: 'item_modified', path, identity: identityKeyOf(right, identity), changes });
    }
  }

  const orphansLeft = [...leftByKey.entries()]
    .filter(([key]) => !matchedLeft.has(key))
    .map(([, item]) => item);

  const rekeyOn = rekeyOnOf(node);
  const rekeyed = new Set<unknown>();
  if (rekeyOn.length) {
    const groupLeft = groupBy(orphansLeft, (item) => keyOf(item, rekeyOn));
    const groupRight = groupBy(orphansRight, (item) => keyOf(item, rekeyOn));
    for (const [key, lefts] of groupLeft) {
      const rights = groupRight.get(key);
      // The uniqueness condition: exactly one orphan per side, or no move can be
      // asserted without guessing which of several went where.
      if (!rights || lefts.length !== 1 || rights.length !== 1) continue;
      const left = lefts[0] as Row;
      const right = rights[0] as Row;
      const moved = identity.filter((name) => String(left?.[name] ?? '') !== String(right?.[name] ?? ''));
      if (moved.length !== 1) continue;
      const field = moved[0] as string;
      rekeyed.add(left);
      rekeyed.add(right);
      out.push({
        op: 'item_rekeyed',
        path,
        identity: identityKeyOf(right, identity),
        field,
        from: left?.[field],
        to: right?.[field],
      });
      /**
       * A rekeyed item may ALSO have changed elsewhere. The move and the edit
       * are two different facts, so they are two operations rather than one that
       * quietly swallows the other.
       */
      const changes = fields
        ? diffFields(fields, left, right, `${path}[]`).filter(
            (c) => !('path' in c && c.path === `${path}[].${field}`),
          )
        : [];
      if (changes.length) {
        out.push({ op: 'item_modified', path, identity: identityKeyOf(right, identity), changes });
      }
    }
  }

  for (const item of orphansLeft) {
    if (rekeyed.has(item)) continue;
    out.push({ op: 'item_removed', path, identity: identityKeyOf(item, identity), item });
  }
  for (const item of orphansRight) {
    if (rekeyed.has(item)) continue;
    out.push({ op: 'item_added', path, identity: identityKeyOf(item, identity), item });
  }
  return out;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * A keyed collection matches on its `keyFields` — the key IS the address, which
 * is why declaring an `identity` next to it is a registration error.
 */
function diffKeyed(path: string, node: CollectionNode, a: unknown[], b: unknown[]): DiffOp[] {
  return diffByIdentity(path, node, a, b, node.keyFields ?? []);
}

function diffCollection(path: string, node: CollectionNode, a: unknown, b: unknown): DiffOp[] {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (collectionKindOf(node) === 'keyed') return diffKeyed(path, node, left, right);
  const identity = identityOf(node);
  if (identity.length) return diffByIdentity(path, node, left, right, identity);
  return diffByIndex(path, node, left, right);
}

/** One level of a schema, over the two corresponding rows. Recursive by nature. */
function diffFields(
  schema: Readonly<Record<string, FieldNode>>,
  a: Row | undefined,
  b: Row | undefined,
  prefix: string,
): DiffOp[] {
  const out: DiffOp[] = [];
  for (const [name, node] of Object.entries(schema)) {
    /**
     * `systemManaged` is out of the delta by declaration, not by a hard-coded
     * list of two timestamps. That is what makes "these two entities differ only
     * in `updatedAt`" report `noop` for every type at once, including one added
     * later that declares a third such field.
     */
    if (node.systemManaged || node.transientInput || node.localSurrogate) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const left = a?.[name];
    const right = b?.[name];

    if (node.type === 'collection') {
      out.push(...diffCollection(path, node, left, right));
      continue;
    }
    if (isOpaque(node)) {
      const change = opaqueChange(path, left, right);
      if (change) out.push(change);
      continue;
    }
    if (node.type === 'object') {
      out.push(...diffFields(node.fields, left as Row, right as Row, path));
      continue;
    }
    if (!jsonEqual(left, right)) {
      out.push({ op: 'field_changed', path, from: left ?? null, to: right ?? null });
    }
  }
  return out;
}

/**
 * The whole delta between two snapshots of one type.
 *
 * `slug` is not compared: it is the identity the two snapshots are paired BY,
 * so a difference in it would mean the caller paired the wrong two rows. Tags
 * come last, after every field operation, for the determinism reason in
 * {@link diffTags}.
 */
export function diffFromSchema(
  schema: Readonly<Record<string, FieldNode>>,
  a: unknown,
  b: unknown,
): DiffOp[] {
  const left = (a ?? {}) as Row;
  const right = (b ?? {}) as Row;
  return [...diffFields(schema, left, right, ''), ...diffTags(left.tags, right.tags)];
}
