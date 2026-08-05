/**
 * The `endpoint` ↔ `dto` join, tested where it now lives.
 *
 * 2.0.0 — the `syncEndpointDtos` cases that used to open this file are GONE with
 * the function. They drove the join through the endpoint SERVICE, and tier K
 * deleted every entity service, so what they pinned had become unreachable: the
 * function answered `entity service for type 'endpoint' not registered` for
 * every input the running system could hand it, and three green tests kept
 * reading as coverage of a write path this file no longer has.
 *
 * What is left is the two reads, which go in OPPOSITE directions and — as of
 * 2.0.0 — through opposite doors. Both are exercised against a REAL generated
 * projection, because the thing most worth catching is the two of them
 * disagreeing with the DDL the host emits from the same declarations.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  findDtoEndpoints,
  readEndpointDtos,
  type JunctionReader,
} from '../../src/entity/junction/index.js';
import { generateProjectionDDL } from '../../../../src/server/db/projection.js';
import { readProjectionCollection } from '../../../../src/server/db/projection-read.js';
import { dtoData } from '../../src/entity/dto/schema.js';
import { endpointData } from '../../src/entity/endpoint/schema.js';

const ENDPOINT_MODULE = { type: 'endpoint', data: endpointData };

function db(): Database.Database {
  const handle = new Database(':memory:');
  // 2.0.0: the tables come from the same generator the host runs at boot, over
  // the same declarations the envelope ships — not from a second copy of the DDL.
  for (const module of [{ type: 'dto', data: dtoData }, ENDPOINT_MODULE]) {
    for (const statement of generateProjectionDDL(module)) handle.exec(statement);
  }
  return handle;
}

/**
 * The reader `readEndpointDtos` sees in production, minus the host wiring.
 *
 * `readCollection` delegates to the SAME `readProjectionCollection` the real
 * `RawEntityReader` calls, so the column→field re-keying under test here is the
 * production one. A hand-rolled stub returning field-shaped objects would prove
 * only that the sort works — and the re-keying is exactly where an embedded-vs-
 * projected mix-up hides.
 */
function reader(handle: Database.Database): JunctionReader {
  return {
    readCollection: (_type, slug, field) =>
      readProjectionCollection(
        handle,
        ENDPOINT_MODULE as never,
        field,
        endpointData.schema[field] as never,
        slug,
      ),
    getEntity: (type, slug) => {
      const row = handle.prepare(`SELECT * FROM ${type} WHERE slug = ?`).get(slug) as
        | Record<string, unknown>
        | undefined;
      return row ? { type, slug, data: row, tags: [] } : null;
    },
  };
}

function seed(handle: Database.Database): void {
  handle.exec(`
    INSERT INTO dto (slug, name, created_at, updated_at) VALUES
      ('b-dto', 'Bravo', '', ''), ('a-dto', 'Alpha', '', '');
    INSERT INTO endpoint (slug, method, path, created_at, updated_at) VALUES
      ('get-users', 'GET', '/users', '', '');
    INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code) VALUES
      ('get-users', 'b-dto', 'response', 200),
      ('get-users', 'a-dto', 'response', 200),
      ('get-users', 'a-dto', 'request', NULL);
  `);
}

describe('junction reads', () => {
  it('orders links by relation, then status code, then the far side’s label', () => {
    // The order is part of the L9 output: view projections are handed over
    // unsorted, so a change here changes rendered bytes. It used to come from
    // the retired `ORDER BY`; `readCollection` answers in projection-row order,
    // so `readEndpointDtos` now has to re-state it — this is what pins that.
    const handle = db();
    try {
      seed(handle);
      expect(
        readEndpointDtos(reader(handle), 'get-users').map((l) => `${l.relation}:${l.dtoName}`),
      ).toEqual(['request:Alpha', 'response:Alpha', 'response:Bravo']);
      expect(findDtoEndpoints(handle, 'a-dto').map((l) => l.relation)).toEqual([
        'request',
        'response',
      ]);
    } finally {
      handle.close();
    }
  });

  it('sorts a null status code FIRST, as the retired SQL did', () => {
    // SQLite orders NULL first ascending. Coercing null to 0 would collide with
    // a real status code, and coercing it to Infinity would move the row to the
    // end — either one silently reorders every endpoint that has a request DTO.
    const handle = db();
    try {
      handle.exec(`
        INSERT INTO dto (slug, name, created_at, updated_at) VALUES ('d', 'D', '', '');
        INSERT INTO endpoint (slug, method, path, created_at, updated_at)
          VALUES ('e', 'GET', '/e', '', '');
        INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code) VALUES
          ('e', 'd', 'response', 500),
          ('e', 'd', 'response', NULL),
          ('e', 'd', 'response', 200);
      `);
      expect(readEndpointDtos(reader(handle), 'e').map((l) => l.statusCode)).toEqual([
        null,
        200,
        500,
      ]);
    } finally {
      handle.close();
    }
  });

  it('cannot hold a dangling link at all — the projection enforces the ref', () => {
    // Worth pinning, because it is what makes the read swap SAFE. The retired
    // SQL reached the DTO through an INNER JOIN, which would have dropped a
    // dangling row; `readEndpointDtos` resolves the name per link and keeps it.
    // Those differ only if a dangling row can exist — and it cannot: a ref
    // INSIDE a projected collection is FK-enforced, deliberately and unlike an
    // embedded one (`projection.ts`, "Referential integrity is ENFORCED here").
    // So the two reads agree on every state the database can actually be in.
    const handle = db();
    try {
      handle.exec(`
        INSERT INTO endpoint (slug, method, path, created_at, updated_at)
          VALUES ('e', 'GET', '/e', '', '');
      `);
      expect(() =>
        handle.exec(`
          INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation, status_code)
            VALUES ('e', 'ghost', 'response', 200);
        `),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      handle.close();
    }
  });

  it('returns an empty list for an entity with no links', () => {
    const handle = db();
    try {
      expect(readEndpointDtos(reader(handle), 'nobody')).toEqual([]);
      expect(findDtoEndpoints(handle, 'nobody')).toEqual([]);
    } finally {
      handle.close();
    }
  });
});
