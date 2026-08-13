/**
 * The `endpoint` ↔ `dto` join. THE only place `endpoint_dto` is spelled.
 *
 * This is why the two types must ship in one envelope. The junction carries a
 * foreign key to each of them, and the reads below join across both tables — a
 * package owning only one side would have to reach into the other's schema, or
 * push the join back onto the host, which is exactly the arrangement 0.2.2
 * removes.
 *
 * Before 0.2.2 the same SQL lived in three host files:
 * `RawEntityReader.findEndpointDtos` / `.findDtoEndpoints` (read, for the
 * serializers) and `EntityWriter.syncEndpointDtos` (restore). All three moved
 * here, queries copied verbatim.
 *
 * 2.0.0 — TWO of those three are now gone again, in opposite ways.
 *
 * `syncEndpointDtos` is deleted: it drove the join through the endpoint SERVICE,
 * and tier K deleted every entity service, so it could no longer run at all. The
 * restore path it served is the host's generated `restore` over the declared
 * `linkedDtos` collection.
 *
 * The FORWARD read is now `readEndpointDtos`, which goes through
 * `reader.readCollection` — see its docstring. What remains on raw SQL is
 * `findDtoEndpoints`, the REVERSE direction, and it remains for a reason worth
 * stating: §1 of the 2.0.0 brief says the projection is not a contract surface
 * and no read may bypass the host, but the host exposes no reverse-`ref` lookup.
 * It knows the graph — `ref: 'dto'` on `linkedDtos[].dto` is what drives rename
 * propagation and restore ordering — it just does not offer it to a view. Until
 * it does, `dto.detail` cannot answer "which endpoints use me" any other way.
 * Filed as a spec patch rather than papered over here.
 */

import type { Database } from 'better-sqlite3';
import { ENDPOINT_DTO_TABLE, ENDPOINT_TYPE } from '../../identity.js';

/**
 * The slice of the L9 view reader this join needs. Structural on purpose: it is
 * satisfied by `HostEntityReader` without this package importing it, which keeps
 * the junction usable from a test with a hand-built reader.
 */
export interface JunctionReader {
  readCollection(type: string, slug: string, field: string): unknown[];
  getEntity(type: string, slug: string): unknown;
}

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

/**
 * The reverse: endpoints linked to one DTO.
 *
 * The last raw-SQL read in this package, and the only one with no generic
 * equivalent — see the file header.
 */
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

/**
 * The FORWARD read — one endpoint's links — through the host, not the table.
 *
 * `linkedDtos` is a declared collection with `keyFields`, so it projects to its
 * own table and `RawEntityReader.readCollection` reads it back keyed by the
 * FIELD names the type declared (`dto`/`relation`/`statusCode`), not by the
 * columns SQLite happens to hold. That is the whole reason to prefer it over the
 * `SELECT` this replaced: the projection stops being a surface this package has
 * to keep agreeing with.
 *
 * `dtoName` is the one thing the collection cannot answer — it lives on the DTO,
 * not on the link — so it is resolved per link through `reader.getEntity`, which
 * is the generic single-row read. That is a lookup per link rather than one
 * JOIN; a view renders a handful of links, and correctness of the contract beats
 * a query count at that size.
 *
 * ORDER is reproduced deliberately, not inherited. The retired SQL ended
 * `ORDER BY ed.relation, ed.status_code, d.name`, row order is part of the L9
 * output, and `readCollection` answers in projection-row order — so the sort has
 * to be re-stated here or rendered bytes move. SQLite sorts NULL FIRST ascending,
 * which is why a null `statusCode` is compared as -Infinity rather than coerced
 * to 0 (a real status code) or to the end.
 */
export function readEndpointDtos(reader: JunctionReader, endpointSlug: string): JunctionDtoLink[] {
  const links = reader.readCollection(ENDPOINT_TYPE, endpointSlug, 'linkedDtos') as Array<{
    dto?: unknown;
    relation?: unknown;
    statusCode?: unknown;
  }>;

  return links
    .map((link) => {
      const dtoSlug = typeof link.dto === 'string' ? link.dto : '';
      // 0.2.22 — the DTO's label is `title`; `name` is gone from the type.
      const dto = reader.getEntity('dto', dtoSlug) as { data?: { title?: unknown } } | null;
      const name = dto?.data?.title;
      return {
        dtoSlug,
        // Defensive only: a ref inside a PROJECTED collection is FK-enforced
        // (unlike an embedded one, which degrades to `onMissing: 'warn'`), so a
        // link whose DTO is missing cannot exist in the table. That is also what
        // makes this read equivalent to the INNER JOIN it replaced.
        dtoName: typeof name === 'string' ? name : dtoSlug,
        relation: typeof link.relation === 'string' ? link.relation : '',
        statusCode: typeof link.statusCode === 'number' ? link.statusCode : null,
      };
    })
    .sort(
      (a, b) =>
        a.relation.localeCompare(b.relation) ||
        (a.statusCode ?? -Infinity) - (b.statusCode ?? -Infinity) ||
        a.dtoName.localeCompare(b.dtoName),
    );
}
