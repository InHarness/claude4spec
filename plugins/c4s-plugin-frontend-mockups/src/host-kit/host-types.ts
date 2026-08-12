/**
 * Structural types for the cross-cutting host services this package receives
 * through `MountContext`.
 *
 * The published Host API types those slots `any`, deliberately — their real
 * types pull express, better-sqlite3 and the Tiptap registry, none of which is
 * part of the contract. So a plugin declares the SHAPE it actually uses, and
 * gets compile-time checking on exactly the calls it makes.
 *
 * This envelope contributes no `backend` block at all — neither type registers
 * routes, a service or an MCP server — so the list here is short: the two shapes
 * the serializers are handed.
 */

/** One row as the generic reader hands it over, before a serializer shapes it. */
export interface RawEntity {
  type: string;
  slug: string;
  data: Record<string, unknown>;
  tags: string[];
}

/** A page section that references an entity. */
export interface SectionEntityRef {
  anchor: string;
  pagePath: string;
  headingText: string;
  relation: string;
}
