/**
 * Structural types for the host services this envelope receives through
 * `MountContext`.
 *
 * The published Host API types those slots `any`, deliberately — their real
 * types pull express, better-sqlite3 and the Tiptap registry, none of which is
 * part of the contract. So a plugin declares the SHAPE it actually uses and gets
 * compile-time checking on exactly the calls it makes. Everything below is what
 * this package touches and nothing more; widening it to mirror the host class
 * would be re-importing the internal by hand.
 *
 * This is a deliberate near-copy of the same file in the `api-contracts`
 * envelope, minus the members that envelope needs and this one does not.
 */

/** How a change is attributed in the version log. */
export type ChangedBy = 'user' | 'agent' | 'filesystem';

/** One row as the generic reader hands it over, before a serializer shapes it. */
export interface RawEntity {
  type: string;
  slug: string;
  data: Record<string, unknown>;
  tags: string[];
}

/** One cell as it lives in the keyed collection: the key, plus the payload. */
export interface SparseCell {
  r: number;
  c: number;
  value: string;
}

/** The read half of `MountContext`, narrowed to the two calls this package makes. */
export interface ReaderLike {
  readCollection(type: string, slug: string, field: string): unknown[];
  getEntity(type: string, slug: string): unknown;
}

/**
 * The keyed half of `ctx.crud` — the only write door a grid may use.
 *
 * `update` is deliberately absent from this interface even though the facade
 * carries it: it reconciles a supplied keyed collection REPLACE-ALL, so reaching
 * for it to change one cell would silently delete every cell the caller did not
 * resend. Not typing it here is the cheapest way to make that unreachable from
 * this package.
 */
export interface KeyedCrudLike {
  writeCollectionWindow(
    type: string,
    slug: string,
    field: string,
    entries: readonly Record<string, unknown>[],
    actor: ChangedBy,
  ): Promise<{ slug: string; warnings?: string[] }>;
  mutateCollectionAxis(
    type: string,
    slug: string,
    field: string,
    axisKey: string,
    op: 'insert' | 'delete',
    at: number,
    actor: ChangedBy,
  ): Promise<{ slug: string; extent: number }>;
}

/** One axis as `collectionOverview` reports it. */
export interface CollectionAxis {
  key: string;
  extent: string;
  length: number;
}

export interface CollectionOverviewResult {
  type: string;
  slug: string;
  field: string;
  axes: CollectionAxis[];
  itemFields: string[];
}

export interface CollectionWindowResult {
  type: string;
  slug: string;
  field: string;
  window: Array<{ key: string; from: number; to: number }>;
  /**
   * DENSE row-major over the whole rectangle, first declared axis outer, with
   * the COORDINATES DROPPED — an element is the decoded payload, so for this
   * type it is `{ value: string | null }` and never a bare string. An unwritten
   * coordinate materialises as `{ value: null }` rather than being omitted.
   */
  items: unknown[][];
}

/** The discovery core, narrowed to the two collection reads. */
export interface DiscoveryLike {
  collectionOverview(input: { type: string; slug: string; field: string }): CollectionOverviewResult;
  collectionWindow(input: {
    type: string;
    slug: string;
    field: string;
    a1: number;
    b1: number;
    a2: number;
    b2: number;
  }): CollectionWindowResult;
}
