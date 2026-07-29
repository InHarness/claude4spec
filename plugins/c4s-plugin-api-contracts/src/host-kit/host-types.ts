/**
 * Structural types for the cross-cutting host services this package receives
 * through `MountContext`.
 *
 * The published Host API types those slots `any`, deliberately — their real
 * types pull express, better-sqlite3 and the Tiptap registry, none of which is
 * part of the contract. So a plugin declares the SHAPE it actually uses, and
 * gets compile-time checking on exactly the calls it makes. Each interface
 * below is the members this package touches and nothing more; widening one to
 * mirror the host class would be re-importing the internal by hand.
 */

import type { EndpointDtoRelation } from '../types.js';

/** How a change is attributed in the version log. */
export type ChangedBy = 'user' | 'agent' | 'filesystem';

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

export interface TagsServiceLike {
  assignTags(entityType: string, entitySlug: string, tagNames: string[]): string[];
  getEntityTagSlugs(entityType: string, entitySlug: string): string[];
}

export interface VersionServiceLike {
  captureEntitySnapshot(
    type: string,
    entitySlug: string,
    op: 'create' | 'update' | 'delete',
    actor: ChangedBy,
    summary: string | null,
    serializerVersion: string,
  ): unknown;
}

/** The JSON entity store — source of truth; SQLite is the derived index. */
export interface EntityStoreLike {
  persist(type: string, slug: string): void;
  remove(type: string, slug: string): void;
}

export interface ReferencesServiceLike {
  findReferences(type: string, slug: string): Promise<unknown[]>;
  propagateSlugChange(type: string, oldSlug: string, newSlug: string): Promise<{ changed: string[] }>;
}

export interface WsEmitterLike {
  broadcast(msg: unknown): void;
}

/** Re-exported for the junction's benefit — see `entity/junction/index.ts`. */
export type { EndpointDtoRelation };
