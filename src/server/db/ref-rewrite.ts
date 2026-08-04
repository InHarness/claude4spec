/**
 * Host API 2.0.0 (brief item 24) — the host repoints references it generated.
 *
 * `projection.ts` derives a type's tables from its `data.schema` and
 * `projection-write.ts` writes rows into them. This is the third half of the
 * same idea: when an entity changes slug, rewrite every value that referenced
 * it, using only the `ref` flags on the declaration.
 *
 * WHAT IT REPLACES. 0.2.2 moved three hardcoded branches out of the host's
 * `ReferencesService` and into `backend.onEntityRenamed`, one hook per module
 * that owned a reference — ac rewrote `verifies[].slug` in its own JSON column,
 * ui-view rewrote `design_system_slug`, endpoint re-persisted the files whose
 * junction rows the FK had already cascaded. That was the right move while the
 * host could not know which types cared. It can now: `ref: '<type>'` says so on
 * the field itself, so the three hooks are three spellings of one rule and the
 * slot they hang on is gone (see `HOST_API_CHANGELOG`).
 *
 * THE RULE, ONCE. For every field flagged `ref` whose target is the renamed
 * type, replace `oldSlug` with `newSlug` wherever that field is physically
 * stored — a column on the entity row, a column in a projection table, or a
 * value nested inside an embedded-JSON collection or object. `ref: '$type'` is
 * polymorphic: it only matches when the SIBLING field named `type` carries the
 * renamed type, which is what lets `ac.verifies[]` point at a
 * plugin-contributed type the host has never heard of.
 *
 * WHAT IT DOES NOT DO. It does not touch page markdown (the caller,
 * `ReferencesService.propagateSlugChange`, owns that and its rollback), it does
 * not write entity files (the caller re-persists the slugs this returns), and it
 * does not validate that `newSlug` exists. It reports which entities of one type
 * it changed, and nothing else.
 */

import type { Database } from 'better-sqlite3';
import {
  columnOf,
  hasProjectionTable,
  isEmbedded,
  type CollectionNode,
  type FieldNode,
} from '../../shared/plugin-host/data-schema.js';
import { bindingColumnOf, mainTableOf, projectionTableOf, type ProjectableModule } from './projection.js';

/** The sibling field a `ref: '$type'` reads its target type from. */
const TYPE_DISCRIMINATOR = 'type';

interface Rename {
  renamedType: string;
  oldSlug: string;
  newSlug: string;
}

/**
 * True when this node's `ref` points at the type being renamed.
 *
 * `siblingType` is the value of the `type` field beside it — `undefined` where
 * there is no such sibling, which makes a `$type` ref unresolvable and so
 * unmatched. Silently rewriting an unresolvable polymorphic ref would repoint
 * `{type: 'diagram', slug: 'login'}` on a rename of `ac/login`.
 */
function refMatches(node: FieldNode, renamedType: string, siblingType: unknown): boolean {
  if (!node.ref) return false;
  if (node.ref === '$type') return siblingType === renamedType;
  return node.ref === renamedType;
}

/**
 * Rewrite a parsed JSON value in place along its declared shape.
 *
 * Returns true when anything changed, so the caller can skip the write for a row
 * that only matched the `LIKE` prefilter. Shape-driven rather than path-driven:
 * an object recursing into its own fields is the only place a `$type` sibling is
 * in scope, and threading it through dotted paths would mean re-resolving the
 * parent on every leaf.
 */
function rewriteValue(node: FieldNode, value: unknown, rename: Rename): { value: unknown; changed: boolean } {
  if (node.kind === 'collection') {
    if (!Array.isArray(value)) return { value, changed: false };
    let changed = false;
    const items = value.map((item) => {
      const result = rewriteValue(node.item, item, rename);
      if (result.changed) changed = true;
      return result.value;
    });
    return { value: changed ? items : value, changed };
  }

  if (node.kind === 'record') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const result = rewriteValue(node.value, entry, rename);
      if (result.changed) changed = true;
      out[key] = result.value;
    }
    return { value: changed ? out : value, changed };
  }

  if (node.kind === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
    const record = value as Record<string, unknown>;
    const siblingType = record[TYPE_DISCRIMINATOR];
    let changed = false;
    const out: Record<string, unknown> = { ...record };
    for (const [name, child] of Object.entries(node.fields)) {
      if (refMatches(child, rename.renamedType, siblingType)) {
        if (record[name] === rename.oldSlug) {
          out[name] = rename.newSlug;
          changed = true;
        }
        continue;
      }
      const result = rewriteValue(child, record[name], rename);
      if (result.changed) {
        out[name] = result.value;
        changed = true;
      }
    }
    return { value: changed ? out : value, changed };
  }

  return { value, changed: false };
}

/** True when any node in this subtree satisfies `pred` — the cheap prefilter before touching SQL. */
function subtreeHasRef(node: FieldNode, pred: (ref: string) => boolean): boolean {
  if (node.ref && pred(node.ref)) return true;
  if (node.kind === 'collection') return subtreeHasRef(node.item, pred);
  if (node.kind === 'record') return subtreeHasRef(node.value, pred);
  if (node.kind === 'object') {
    return Object.values(node.fields).some((child) => subtreeHasRef(child, pred));
  }
  return false;
}

/** `$type` can resolve to anything, so a subtree carrying one is always a candidate. */
const targets = (renamedType: string) => (ref: string) => ref === '$type' || ref === renamedType;

/**
 * Repoint every reference to `oldSlug` held by ONE module's tables.
 *
 * Returns the slugs of that module's entities whose stored data changed, so the
 * caller can re-persist their files. Callers get the empty array for a module
 * that references the renamed type nowhere — the overwhelmingly common case, and
 * the reason the prefilters above run before any statement is prepared.
 */
export function rewriteRefsForRename(
  db: Database,
  module: ProjectableModule,
  renamedType: string,
  oldSlug: string,
  newSlug: string,
): string[] {
  const schema = module.data?.schema;
  if (!schema || oldSlug === newSlug) return [];
  const rename: Rename = { renamedType, oldSlug, newSlug };

  const mainTable = mainTableOf(module);
  const affected = new Set<string>();

  // The sibling column a top-level `ref: '$type'` reads its type from. No type
  // in this repo declares one; a plugin may, and resolving it here costs one
  // lookup rather than a special case at the call site.
  const topLevelType = schema[TYPE_DISCRIMINATOR];
  const typeColumn =
    topLevelType && isEmbedded(topLevelType) ? columnOf(TYPE_DISCRIMINATOR, topLevelType) : null;

  for (const [name, node] of Object.entries(schema)) {
    if (!subtreeHasRef(node, targets(renamedType))) continue;

    // (1) The ref is a column in a projection table of its own. The generated FK
    // carries ON UPDATE CASCADE, so by the time this runs the column may already
    // hold `newSlug` — the UPDATE is therefore a no-op in the normal case and
    // the point of this branch is collecting the parents to re-persist. Run it
    // anyway: the cascade only fires for a ref with a real FK, and a `$type` ref
    // never gets one.
    if (hasProjectionTable(node)) {
      const collection = node as CollectionNode;
      if (collection.item.kind !== 'object') continue;
      const table = projectionTableOf(module, name, collection);
      const binding = bindingColumnOf(module);
      for (const [itemField, itemNode] of Object.entries(collection.item.fields)) {
        if (!itemNode.ref) continue;
        // A polymorphic ref in a projection table narrows by its sibling COLUMN.
        const discriminator = collection.item.fields[TYPE_DISCRIMINATOR];
        let scope = '';
        const scopeParams: string[] = [];
        if (itemNode.ref === '$type') {
          if (!discriminator) continue;
          scope = ` AND ${columnOf(TYPE_DISCRIMINATOR, discriminator)} = ?`;
          scopeParams.push(renamedType);
        } else if (itemNode.ref !== renamedType) {
          continue;
        }
        const column = columnOf(itemField, itemNode);
        for (const row of db
          .prepare(`SELECT DISTINCT ${binding} AS parent FROM ${table} WHERE ${column} IN (?, ?)${scope}`)
          .all(oldSlug, newSlug, ...scopeParams) as Array<{ parent: string }>) {
          affected.add(row.parent);
        }
        db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?${scope}`).run(
          newSlug,
          oldSlug,
          ...scopeParams,
        );
      }
      continue;
    }

    if (!isEmbedded(node)) continue;
    const column = columnOf(name, node);

    // (2) A scalar ref sitting directly on the entity row is one UPDATE. A
    // top-level `$type` ref resolves against the row's own `type` column, and is
    // skipped when the schema declares no such sibling — see `refMatches`.
    if (node.kind !== 'collection' && node.kind !== 'object' && node.kind !== 'record') {
      let scope = '';
      const params: string[] = [oldSlug];
      if (node.ref === '$type') {
        if (!typeColumn) continue;
        scope = ` AND ${typeColumn} = ?`;
        params.push(renamedType);
      } else if (node.ref !== renamedType) {
        continue;
      }
      for (const row of db
        .prepare(`SELECT slug FROM ${mainTable} WHERE ${column} = ?${scope}`)
        .all(...params) as Array<{ slug: string }>) {
        affected.add(row.slug);
      }
      db.prepare(`UPDATE ${mainTable} SET ${column} = ? WHERE ${column} = ?${scope}`).run(newSlug, ...params);
      continue;
    }

    // (3) The ref is nested inside an embedded-JSON column. `LIKE` is a
    // prefilter, not the match: it over-selects rows whose JSON merely contains
    // the slug as a substring, and `rewriteValue` decides.
    const candidates = db
      .prepare(`SELECT slug, ${column} AS payload FROM ${mainTable} WHERE ${column} LIKE ?`)
      .all(`%${oldSlug}%`) as Array<{ slug: string; payload: string | null }>;
    if (!candidates.length) continue;
    const update = db.prepare(`UPDATE ${mainTable} SET ${column} = ? WHERE slug = ?`);
    for (const row of candidates) {
      if (!row.payload) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.payload);
      } catch {
        // A column holding non-JSON is an indexing bug, not this operation's to
        // report — skipping it leaves the row exactly as it was found.
        continue;
      }
      const result = rewriteValue(node, parsed, rename);
      if (!result.changed) continue;
      update.run(JSON.stringify(result.value), row.slug);
      affected.add(row.slug);
    }
  }

  return [...affected];
}

/** True when a module declares any `ref` at all — the host only registers a listener for those. */
export function declaresRefs(module: ProjectableModule): boolean {
  const schema = module.data?.schema;
  if (!schema) return false;
  return Object.values(schema).some((node) => subtreeHasRef(node, () => true));
}
