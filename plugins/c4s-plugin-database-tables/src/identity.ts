/**
 * Every constant both halves of this envelope agree on, and the one derivation
 * they share.
 *
 * DELIBERATELY `.ts`, NOT `.tsx`, AND FREE OF REACT. The Node loader imports
 * `src/index.ts`, which reaches this file; if a React import were reachable from
 * here the backend bundle would pull the whole renderer into a process that has
 * no DOM. The frontend imports the same names from the same place, so the two
 * halves cannot drift on a table name or a path prefix — the failure mode that
 * produces a list screen calling a route the router never mounted.
 */

/** The entity type name. `typeTablePrefix` turns this into the `database_table` table. */
export const DATABASE_TABLE_TYPE = 'database-table';

/**
 * The REST prefix, mounted under `/api` by the host — `/api/database-tables`.
 *
 * Written out rather than derived: nothing in the host pluralises, and the
 * existing prefixes prove why (`ac` → `/acs`, `ui-view` → `/ui-views`). It is
 * also the client-side route prefix, which is what keeps `openEntityRoute` and
 * the serializer's `href` agreeing.
 */
export const DATABASE_TABLE_PATH_PREFIX = '/database-tables';

export const DATABASE_TABLE_LABEL = 'Database Table';
export const DATABASE_TABLE_LABEL_PLURAL = 'Database Tables';

/** Sidebar position, inherited from the retired plugin so the tab does not move. */
export const DATABASE_TABLE_DISPLAY_ORDER = 100;

/**
 * The slash-create popover discriminator.
 *
 * The command is declared ONCE, on the manifest's `commands` contribution,
 * which is the only declaration carrying a `popoverKind` for `invokeSlash` to
 * dispatch on. Declaring it a second time as a `slashCommand` on
 * `editorExtensions` makes the palette prefer the module-borne entry, which
 * deletes the typed text and opens nothing.
 */
export const DATABASE_TABLE_POPOVER_KIND = 'database-table-create';

/** Attribute order for the serialized reference tag — fixed, so diffs stay stable. */
export const DATABASE_TABLE_ATTR_ORDER = ['type', 'slug'] as const;

/**
 * The HOST's slug normalisation, vendored byte-for-byte from `src/shared/slug.ts`.
 *
 * The detail panel only sends `newSlug` when the slug it computes DIFFERS from
 * the current one, so a client that disagrees with the server about slugification
 * either renames when it should not or fails to when it should. That makes this
 * a correctness dependency, not a convenience.
 *
 * The retired plugin shipped its own NFKD-based version, and it was WRONG for
 * this corpus: `ł` has no NFD decomposition, so `Zbiórka_Ł` slugified one way in
 * the browser and another on the server. The explicit `ł → l` map below is the
 * host's fix, and half the real corpus is Polish.
 *
 * Vendored rather than imported because `@c4s/plugin-runtime` does not export
 * it; if it ever does, delete this and import it.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base;
  // An input outside the Latin-diacritic set (CJK, Cyrillic, …) or pure
  // punctuation collapses to '' above; a deterministic fallback keeps the
  // result non-empty and never dot-prefixed.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `x-${hash.toString(36)}`;
}

/**
 * The index name a consumer shows when the author did not write one.
 *
 * Applied at the point of DISPLAY and nowhere else. Canonicalising a missing
 * name INTO the payload would rewrite authored data on every snapshot and
 * destroy the byte-identity the version history rests on — which is also why
 * `indexes[].name` stays optional in the declaration rather than acquiring a
 * `computedDefault`.
 */
export function deriveIndexName(table: string, index: { name?: string; columns: string[] }): string {
  if (index.name && index.name.trim()) return index.name;
  return `idx_${table}_${index.columns.join('_')}`;
}
