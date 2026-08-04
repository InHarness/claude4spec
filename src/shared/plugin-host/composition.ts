/**
 * 0.2.4 — the ONE place a composition descriptor is normalized.
 * Host API 2.0.0 — and the ONE thing it is normalized FROM is `data.schema`.
 *
 * Five consumers read how an entity is composed: M17 capture, the core read
 * layer, the manifest→runtime adapter, the M29 indexer, and the client
 * passthrough. Before 0.2.4 they all read `manifest.table` directly, so the
 * moment one of them needed more than a single table name (a junction to clear,
 * a shared table to scope) it grew its own private answer. Normalizing here —
 * in `shared/`, so the client adapter uses the identical rule — means a type's
 * composition has exactly one definition regardless of who is asking.
 *
 * 2.0.0 finishes the job by removing the two slots it used to read. `table` and
 * `composition` are gone from the manifest: a descriptor authored by hand
 * alongside hand-written DDL was a second description of the same tables, free
 * to disagree with the first. Both are now DERIVED from the declaration the
 * projection generator reads, so the descriptor cannot name a table the
 * generator does not create.
 *
 * Consumers call `compositionOf(module)`, never anything else.
 */

import { hasProjectionTable, snakeCase, type CollectionNode, type DataDeclaration } from './data-schema.js';
import type { EntityModuleManifest } from './types.js';

/** The shape every consumer reads. Total — never optional, never re-derived. */
export interface ResolvedComposition {
  type: string;
  mainTable: string;
  identityColumn: string;
  /**
   * `bindingColumn` is now always known: the host GENERATED the table, so it
   * knows exactly how it binds, and a scoped DELETE against it is safe. The
   * `null` arm survives in the type only for the shape's other reader — before
   * 2.0.0 a table inherited from `backend.auxTables` carried no binding and
   * could only ever be cleared wholesale.
   */
  derivedTables: ReadonlyArray<{ table: string; bindingColumn: string | null }>;
  sharedTables: ReadonlyArray<{ table: string; scopePredicate: string }>;
  /**
   * Always `false` since 2.0.0 — every descriptor is derived from a schema.
   * Retained so the field's consumers keep compiling while the checks that
   * branched on it are retired.
   */
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
type CompositionInput = Pick<EntityModuleManifest, 'type'> & {
  data?: DataDeclaration | undefined;
};

/**
 * The descriptor for a module, derived entirely from its logical schema.
 *
 * Derivation rules, each the same rule the projection generator applies:
 *   - `mainTable` is the type slug with hyphens as underscores (`typeTablePrefix`);
 *   - `identityColumn` is `slug` — universal, and both the reader and the
 *     indexer have always hardcoded `WHERE slug = ?`;
 *   - one derived table per collection that projects to a table of its own,
 *     each with a KNOWN binding column, unlike the legacy `auxTables` entries
 *     whose null binding forced wholesale clears;
 *   - one shared table, `entity_tag`, scoped by type — the same predicate
 *     `EntityIndexerService.handleUnlink` has always written by hand.
 *
 * A module with no schema (a hand-built test double) still gets a total
 * descriptor: the type slug names its table and it owns nothing else.
 */
export function resolveComposition(module: CompositionInput): ResolvedComposition {
  const mainTable = typeTablePrefix(module.type);
  const derived: Array<{ table: string; bindingColumn: string | null }> = [];
  for (const [name, node] of Object.entries(module.data?.schema ?? {})) {
    if (!hasProjectionTable(node)) continue;
    const collection = node as CollectionNode;
    derived.push({
      table: collection.projectionTable ?? `${mainTable}_${snakeCase(name)}`,
      bindingColumn: `${mainTable}_slug`,
    });
  }
  return {
    type: module.type,
    mainTable,
    identityColumn: 'slug',
    derivedTables: derived,
    sharedTables: [{ table: 'entity_tag', scopePredicate: defaultSharedScope(module.type) }],
    legacy: false,
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

/** Every table a descriptor addresses, main first. Used by clearing and diagnostics. */
export function allTablesOf(resolved: ResolvedComposition): string[] {
  return [
    resolved.mainTable,
    ...resolved.derivedTables.map((d) => d.table),
    ...resolved.sharedTables.map((s) => s.table),
  ];
}
