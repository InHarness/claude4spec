/**
 * 0.2.4 — the ONE place a composition descriptor is normalized.
 *
 * Five consumers read how an entity is composed: M17 capture, the core read
 * layer, the manifest→runtime adapter, the M29 indexer, and the client
 * passthrough. Before this they all read `manifest.table` directly, so the
 * moment one of them needed more than a single table name (a junction to clear,
 * a shared table to scope) it grew its own private answer. Normalizing here —
 * in `shared/`, so the client adapter uses the identical rule — means a type's
 * composition has exactly one definition regardless of who is asking.
 *
 * Consumers call `compositionOf(module)`, never `module.table` and never
 * `module.composition`. The former is the deprecated fallback and the latter is
 * optional; only the resolved value is total.
 */

import type { EntityComposition, EntityModuleManifest } from './types.js';

/** The shape every consumer reads. Total — never optional, never re-derived. */
export interface ResolvedComposition {
  type: string;
  mainTable: string;
  identityColumn: string;
  /**
   * `bindingColumn: null` marks a table inherited from the legacy
   * `backend.auxTables` slot. It is DELIBERATE and load-bearing: the host does
   * not know how `endpoint_dto` binds to `endpoint`, so such a table may only
   * ever be cleared wholesale, never scoped. Synthesizing a plausible
   * `${type}_slug` would produce scoped DELETEs that are silently wrong.
   */
  derivedTables: ReadonlyArray<{ table: string; bindingColumn: string | null }>;
  sharedTables: ReadonlyArray<{ table: string; scopePredicate: string }>;
  /** True when synthesized from `table` + `auxTables` rather than declared. */
  legacy: boolean;
}

/**
 * Host-owned tables shared between entity types. A type may name one of these
 * ONLY under `sharedTables`, and only with a scope predicate.
 */
export const HOST_SHARED_TABLES: ReadonlySet<string> = new Set(['entity_tag']);

/** The SQL-identifier prefix a type's own tables must carry. */
export function typeTablePrefix(type: string): string {
  return type.replaceAll('-', '_');
}

/** The predicate isolating one type's rows in a shared table. */
export function defaultSharedScope(type: string): string {
  return `entity_type = '${type}'`;
}

/** A module as seen by the normalizer — server and client shapes both satisfy it. */
type CompositionInput = Pick<EntityModuleManifest, 'type' | 'table' | 'composition'> & {
  backend?: { auxTables?: string[] } | undefined;
};

/**
 * The descriptor for a module, declared or synthesized.
 *
 * Fallback rules when `composition` is absent:
 *   - `identityColumn: 'slug'` — universal today: every entity table is keyed
 *     `slug TEXT PRIMARY KEY`, and both the reader and the indexer already
 *     hardcode `WHERE slug = ?`.
 *   - derived tables come from `backend.auxTables` with a null binding column
 *     (see {@link ResolvedComposition.derivedTables}).
 *   - one shared table, `entity_tag`, scoped by type — the same predicate
 *     `EntityIndexerService.handleUnlink` has always written by hand. Supplying
 *     it here is what lets the rebuild scope its clear without every existing
 *     module being re-authored.
 */
export function resolveComposition(module: CompositionInput): ResolvedComposition {
  const declared = module.composition;
  if (declared) {
    return {
      type: module.type,
      mainTable: declared.mainTable,
      identityColumn: declared.identityColumn,
      derivedTables: (declared.derivedTables ?? []).map((d) => ({
        table: d.table,
        bindingColumn: d.bindingColumn,
      })),
      sharedTables: (declared.sharedTables ?? []).map((s) => ({
        table: s.table,
        scopePredicate: s.scopePredicate,
      })),
      legacy: false,
    };
  }
  return {
    type: module.type,
    mainTable: module.table,
    identityColumn: 'slug',
    derivedTables: (module.backend?.auxTables ?? []).map((table) => ({
      table,
      bindingColumn: null,
    })),
    sharedTables: [{ table: 'entity_tag', scopePredicate: defaultSharedScope(module.type) }],
    legacy: true,
  };
}

/**
 * Where a resolved descriptor is cached on the module. Attached once at
 * registration so validation and every read agree by construction; a module
 * built by hand in a test has no cache and is normalized on the fly.
 */
export const RESOLVED_COMPOSITION = Symbol.for('c4s.resolvedComposition');

type MaybeCached = { [RESOLVED_COMPOSITION]?: ResolvedComposition };

/** Attach the resolved descriptor to a module. Idempotent, like `synthesizeMount`. */
export function attachResolvedComposition<T extends CompositionInput>(
  module: T,
  resolved: ResolvedComposition,
): T {
  Object.defineProperty(module, RESOLVED_COMPOSITION, {
    value: resolved,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return module;
}

/**
 * THE accessor. Every consumer goes through this — not `module.table`, not
 * `module.composition`.
 */
export function compositionOf(module: CompositionInput): ResolvedComposition;
export function compositionOf(module: CompositionInput | null | undefined): ResolvedComposition | null;
export function compositionOf(module: CompositionInput | null | undefined): ResolvedComposition | null {
  if (!module) return null;
  const cached = (module as MaybeCached)[RESOLVED_COMPOSITION];
  if (cached) return cached;
  return resolveComposition(module);
}

/**
 * The DECLARABLE descriptor equivalent to a legacy `table` + `auxTables` pair.
 *
 * `resolveComposition` returns the normalized read shape, whose `derivedTables`
 * carry a nullable binding column and which is `readonly`; a manifest slot needs
 * the authored shape. Both come from this one rule, so a synthesized descriptor
 * cannot drift from a declared one.
 */
export function legacyComposition(
  type: string,
  table: string,
  auxTables: readonly string[] = [],
): EntityComposition {
  return {
    mainTable: table,
    identityColumn: 'slug',
    // A legacy aux table has no known binding column; name it after the type's
    // identity so the DECLARED shape stays well-formed, and note that nothing
    // scopes a delete by it — `resolveComposition` is what the host reads, and
    // there the column is null precisely so such a table is only ever cleared
    // wholesale.
    ...(auxTables.length
      ? { derivedTables: auxTables.map((t) => ({ table: t, bindingColumn: 'slug' })) }
      : {}),
    sharedTables: [{ table: 'entity_tag', scopePredicate: defaultSharedScope(type) }],
  };
}

/** Every table a descriptor addresses, main first. Used by clearing and diagnostics. */
export function allTablesOf(resolved: ResolvedComposition): string[] {
  return [
    resolved.mainTable,
    ...resolved.derivedTables.map((d) => d.table),
    ...resolved.sharedTables.map((s) => s.table),
  ];
}
