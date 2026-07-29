/**
 * The `endpoint` ↔ `dto` join. THE only place `endpoint_dto` is spelled.
 *
 * This is why the two types must ship in one envelope. The junction carries a
 * foreign key to each of them, and the reads below join across both tables — a
 * package owning only one side would have to reach into the other's schema, or
 * push the join back onto the host, which is exactly the arrangement 0.2.2
 * removes.
 *
 * Before this release the same SQL lived in three host files:
 * `RawEntityReader.findEndpointDtos` / `.findDtoEndpoints` (read, for the
 * serializers) and `EntityWriter.syncEndpointDtos` (restore). All three are
 * gone from the host; the queries here are copied verbatim, `ORDER BY` included
 * — the view projections are not re-sorted downstream, so their row order is
 * part of the L9 output.
 */

import type { Database } from 'better-sqlite3';
import { ENDPOINT_DTO_TABLE } from '../../identity.js';
import type { EndpointDtoRelation } from '../../types.js';

/** The link shape as an endpoint sees it. */
export interface JunctionDtoLink {
  dtoSlug: string;
  dtoName: string;
  relation: string;
  statusCode: number | null;
}

/** The link shape as a DTO sees it. */
export interface JunctionEndpointLink {
  endpointSlug: string;
  method: string;
  path: string;
  relation: string;
  statusCode: number | null;
}

/** Links hanging off one endpoint, denormalised with the DTO's name. */
export function findEndpointDtos(db: Database, endpointSlug: string): JunctionDtoLink[] {
  const rows = db
    .prepare(
      `SELECT d.slug AS dto_slug, d.name AS dto_name,
              ed.relation AS relation, ed.status_code AS status_code
         FROM ${ENDPOINT_DTO_TABLE} ed
         JOIN dto d ON d.slug = ed.dto_slug
        WHERE ed.endpoint_slug = ?
        ORDER BY ed.relation, ed.status_code, d.name`,
    )
    .all(endpointSlug) as Array<{
    dto_slug: string;
    dto_name: string;
    relation: string;
    status_code: number | null;
  }>;
  return rows.map((r) => ({
    dtoSlug: r.dto_slug,
    dtoName: r.dto_name,
    relation: r.relation,
    statusCode: r.status_code,
  }));
}

/** The reverse: endpoints linked to one DTO. */
export function findDtoEndpoints(db: Database, dtoSlug: string): JunctionEndpointLink[] {
  const rows = db
    .prepare(
      `SELECT e.slug AS slug, e.method AS method, e.path AS path,
              ed.relation AS relation, ed.status_code AS status_code
         FROM ${ENDPOINT_DTO_TABLE} ed
         JOIN endpoint e ON e.slug = ed.endpoint_slug
        WHERE ed.dto_slug = ?
        ORDER BY ed.relation, ed.status_code, e.path`,
    )
    .all(dtoSlug) as Array<{
    slug: string;
    method: string;
    path: string;
    relation: string;
    status_code: number | null;
  }>;
  return rows.map((r) => ({
    endpointSlug: r.slug,
    method: r.method,
    path: r.path,
    relation: r.relation,
    statusCode: r.status_code,
  }));
}

/** The subset of the endpoint service this join drives. Named by shape. */
export interface JunctionCapable {
  getBySlug(slug: string): { dtos: JunctionDtoLink[] } | null;
  linkDto(
    endpointSlug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null,
    opts: { writeFile: boolean },
  ): unknown;
  unlinkDto(
    endpointSlug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null,
    opts: { writeFile: boolean },
  ): unknown;
}

/**
 * Bring one endpoint's links to exactly `target` — the restore path.
 *
 * Extras are unlinked BEFORE anything is linked: the junction's UNIQUE covers
 * (endpoint, dto, relation, status_code), so an insert-first order can collide
 * with a row that is about to be removed.
 *
 * Every write passes `writeFile: false`. The caller owns the file; re-persisting
 * here would rewrite it once per link and loop the watcher.
 */
export function syncEndpointDtos(
  service: JunctionCapable | null,
  endpointSlug: string,
  target: Array<{ dtoSlug: string; relation: EndpointDtoRelation; statusCode: number | null }>,
): { linked: number; unlinked: number; warnings: string[] } {
  if (!service?.getBySlug) {
    return { linked: 0, unlinked: 0, warnings: [`entity service for type 'endpoint' not registered`] };
  }
  const ep = service.getBySlug(endpointSlug);
  if (!ep) return { linked: 0, unlinked: 0, warnings: [`endpoint '${endpointSlug}' not found`] };

  const keyOf = (l: { dtoSlug: string; relation: string; statusCode: number | null }) =>
    `${l.relation}|${l.dtoSlug}|${l.statusCode ?? 'null'}`;
  const currentSet = new Map(ep.dtos.map((l) => [keyOf(l), l]));
  const targetSet = new Map(target.map((l) => [keyOf(l), l]));

  let linked = 0;
  let unlinked = 0;
  const warnings: string[] = [];

  for (const [k, current] of currentSet) {
    if (targetSet.has(k)) continue;
    try {
      service.unlinkDto(
        endpointSlug,
        current.dtoSlug,
        current.relation as EndpointDtoRelation,
        current.statusCode,
        { writeFile: false },
      );
      unlinked += 1;
    } catch (err) {
      warnings.push(`unlink '${k}' failed: ${(err as Error).message}`);
    }
  }
  for (const [k, want] of targetSet) {
    if (currentSet.has(k)) continue;
    try {
      service.linkDto(endpointSlug, want.dtoSlug, want.relation, want.statusCode, {
        writeFile: false,
      });
      linked += 1;
    } catch (err) {
      warnings.push(`link '${k}' failed: ${(err as Error).message}`);
    }
  }
  return { linked, unlinked, warnings };
}
