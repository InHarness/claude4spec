/**
 * The client-side shapes, mirroring `data.schema`.
 *
 * TYPES ONLY — the declaration is the contract, and these exist so the editor
 * can hold a draft with something better than `unknown`. Nothing here validates;
 * the generated zod at the router does that.
 */

/** A column's soft foreign key. `table` is the target's SLUG, and may dangle. */
export interface ForeignKeyRef {
  table: string;
  column: string;
}

export interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  pk?: boolean;
  /** Free-form: the inherited format allows a number or a boolean here, not only a string. */
  default?: unknown;
  enumValues?: string[];
  fk?: ForeignKeyRef;
  description?: string;
}

/** `name` is OPTIONAL — consumers derive `idx_<table>_<cols…>` via `deriveIndexName`. */
export interface Index {
  columns: string[];
  unique?: boolean;
  name?: string;
}

export interface DatabaseTable {
  slug: string;
  /**
   * 0.2.22 — the reserved label, and this type is the only one where it sits
   * BESIDE `name` rather than replacing it: `name` is the SQL identifier code is
   * generated from, `title` is what a person reads. It starts as a copy.
   */
  title: string;
  name: string;
  description?: string | null;
  columns: Column[];
  indexes: Index[];
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * What a LIST row carries — counts, never the arrays. The serializer's list
 * views project to exactly this; see `views.ts` for why.
 */
/**
 * 0.2.23 — the derived counts are GONE, not merely optional.
 *
 * A list row used to be the type's own `element_list_item` view, which computed
 * `columnCount`/`indexCount`/`hasPrimaryKey` so a list screen never received the
 * arrays. 0.2.22 made record width the caller's and demoted the three to
 * optional, on the reasoning that a type MAY still compute them. No type may:
 * this release removed the read slot entirely, so the arrays are all that ever
 * arrives and the counts are derived where they are drawn (`countsOf`). A
 * primary key is read off `column.pk`, which the declaration carries per column.
 */
export interface DatabaseTableListItem {
  slug: string;
  title: string;
  name: string;
  description?: string | null;
  columns?: Column[];
  indexes?: Index[];
  tags?: string[];
  updatedAt?: string;
}

export interface DatabaseTableListQuery {
  search?: string;
  tags?: string[];
  tagFilter?: 'and' | 'or';
  limit?: number;
  offset?: number;
}

/** `columns` is REQUIRED on create — omitting it is a 400, not an empty table. */
export interface DatabaseTableCreateInput {
  name: string;
  columns: Column[];
  indexes?: Index[];
  description?: string;
  tags?: string[];
}

export interface DatabaseTableUpdateInput {
  name?: string;
  /** A sibling of the payload, not a field of it. Sent ONLY when the slug actually moves. */
  newSlug?: string;
  columns?: Column[];
  indexes?: Index[];
  description?: string | null;
}

/** The detail payload, under the name the ported editor imports it by. */
export type DatabaseTableResponse = DatabaseTable;
