/**
 * The envelope's half of the Host API 2.0.0 de-risking test.
 *
 * `src/server/db/projection.golden.test.ts` keeps the retired DDL for the four
 * types the host contributes directly. `dto` and `endpoint` live here, and their
 * assertions live here with them — importing this package's source into the root
 * test program would pull files that import `@c4s/plugin-runtime` into it, where
 * the specifier resolves to the BUILT `dist/` .d.ts rather than to source, so the
 * root typecheck would silently depend on build order.
 *
 * This file carries the coverage that moved: column equivalence for both tables,
 * and everything about the `endpoint_dto` junction — the one table generated from
 * a value collection rather than as a column, and therefore the one whose UNIQUE
 * tuple, foreign keys and cascade rules exist only because the generator emits
 * them.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, generateProjectionDDL } from '../../../src/server/db/projection.js';
import { dtoData } from '../src/entity/dto/schema.js';
import { endpointData } from '../src/entity/endpoint/schema.js';

/** The DDL as the deleted `backend/migrations.ts` files wrote it, byte for byte. */
const RETIRED_DDL: Record<string, string> = {
  dto: `
    CREATE TABLE IF NOT EXISTS dto (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      fields TEXT NOT NULL DEFAULT '[]',
      examples TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
  endpoint: `
    CREATE TABLE IF NOT EXISTS endpoint (
      slug TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS endpoint_dto (
      endpoint_slug TEXT NOT NULL REFERENCES endpoint(slug) ON DELETE CASCADE ON UPDATE CASCADE,
      dto_slug      TEXT NOT NULL REFERENCES dto(slug)      ON DELETE CASCADE ON UPDATE CASCADE,
      relation TEXT NOT NULL,
      status_code INTEGER,
      UNIQUE(endpoint_slug, dto_slug, relation, status_code)
    );
    CREATE INDEX IF NOT EXISTS idx_endpoint_dto_endpoint ON endpoint_dto(endpoint_slug);
    CREATE INDEX IF NOT EXISTS idx_endpoint_dto_dto      ON endpoint_dto(dto_slug);
  `,
};

const MODULES = [
  { type: 'dto', data: dtoData },
  { type: 'endpoint', data: endpointData },
];

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const columnsOf = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];

function retiredDb(): Database.Database {
  const db = new Database(':memory:');
  // dto before endpoint — the junction's FK names dto(slug), and the retired
  // chain relied on `mountBackend` migrating every module before mounting any.
  db.exec(RETIRED_DDL.dto as string);
  db.exec(RETIRED_DDL.endpoint as string);
  return db;
}

function generatedDb(): Database.Database {
  const db = new Database(':memory:');
  for (const module of MODULES) {
    for (const statement of generateProjectionDDL(module)) db.exec(statement);
  }
  return db;
}

describe('api-contracts projection — equivalence with the retired hand-written DDL', () => {
  it('produces exactly the same set of tables', () => {
    const tables = (db: Database.Database) =>
      (
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
    expect(tables(generatedDb())).toEqual(tables(retiredDb()));
  });

  for (const table of ['dto', 'endpoint', 'endpoint_dto']) {
    it(`${table}: same columns, same order, same types and defaults`, () => {
      const before = columnsOf(retiredDb(), table);
      const after = columnsOf(generatedDb(), table);

      expect(after.map((c) => c.name)).toEqual(before.map((c) => c.name));
      expect(after.map((c) => c.type)).toEqual(before.map((c) => c.type));
      expect(after.map((c) => c.dflt_value)).toEqual(before.map((c) => c.dflt_value));
      expect(after.map((c) => c.pk)).toEqual(before.map((c) => c.pk));

      /**
       * Nullability matches everywhere EXCEPT the primary key, which the
       * generator now always writes `NOT NULL`. In SQLite that is not redundant:
       * a `TEXT PRIMARY KEY` column accepts NULL, a long-standing compatibility
       * quirk. The one deliberate strengthening, asserted rather than skipped.
       */
      for (const [i, col] of after.entries()) {
        const golden = before[i] as ColumnInfo;
        if (col.pk === 1) {
          expect(col.notnull, `${table}.${col.name} PK must be NOT NULL`).toBe(1);
          continue;
        }
        expect(col.notnull, `${table}.${col.name} nullability`).toBe(golden.notnull);
      }
    });
  }

  it('endpoint_dto keeps its UNIQUE tuple', () => {
    const uniqueOf = (db: Database.Database) =>
      (db.prepare(`PRAGMA index_list(endpoint_dto)`).all() as Array<{ name: string; unique: number }>)
        .filter((i) => i.unique === 1)
        .flatMap((i) =>
          (db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>).map(
            (c) => c.name,
          ),
        );
    expect(uniqueOf(generatedDb())).toEqual(uniqueOf(retiredDb()));
  });

  it('endpoint_dto keeps both foreign keys, with the same cascade rules', () => {
    const fksOf = (db: Database.Database) =>
      (
        db.prepare(`PRAGMA foreign_key_list(endpoint_dto)`).all() as Array<{
          table: string;
          from: string;
          to: string;
          on_update: string;
          on_delete: string;
        }>
      )
        .map((f) => `${f.from}->${f.table}.${f.to} upd:${f.on_update} del:${f.on_delete}`)
        .sort();
    expect(fksOf(generatedDb())).toEqual(fksOf(retiredDb()));
  });

  it('endpoint_dto indexes cover the same columns (names follow the generator rule)', () => {
    const coveredColumns = (db: Database.Database) =>
      (
        db.prepare(`PRAGMA index_list(endpoint_dto)`).all() as Array<{
          name: string;
          origin: string;
        }>
      )
        .filter((i) => i.origin === 'c') // created by CREATE INDEX, not by UNIQUE
        .map((i) =>
          (db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>)
            .map((c) => c.name)
            .join(','),
        )
        .sort();

    /**
     * Same two columns, RENAMED: `idx_endpoint_dto_endpoint` →
     * `idx_endpoint_dto_endpoint_slug`, and likewise for `_dto`. The generator
     * names an index after the columns it actually covers, and an index name is
     * not a contract surface — nothing queries by it. On an upgraded database
     * the two old indexes simply remain alongside the new ones.
     */
    expect(coveredColumns(generatedDb())).toEqual(coveredColumns(retiredDb()));
  });
});

describe('api-contracts projection — creation order does not matter', () => {
  /**
   * `applyProjection` iterates modules in `displayOrder`, which has nothing to do
   * with `dependsOn` — so the junction's `REFERENCES dto(slug)` can be emitted
   * before `dto` exists. SQLite resolves a forward FK at DML time rather than at
   * CREATE time, and the call runs with foreign keys off inside one transaction,
   * so this holds; asserting it means a future change to either the ordering or
   * the pragma handling cannot break it silently.
   */
  it('creates a junction whose FK forward-references a table not yet created', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    expect(() =>
      applyProjection(db, [
        { type: 'endpoint', data: endpointData },
        { type: 'dto', data: dtoData },
      ]),
    ).not.toThrow();

    db.prepare(`INSERT INTO dto (slug, name) VALUES ('d', 'D')`).run();
    db.prepare(`INSERT INTO endpoint (slug, method, path) VALUES ('e', 'GET', '/x')`).run();
    db.prepare(
      `INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation) VALUES ('e','d','response')`,
    ).run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM endpoint_dto').get()).toEqual({ n: 1 });

    // And the constraint is live afterwards — foreign keys go back ON.
    expect(() =>
      db
        .prepare(
          `INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation) VALUES ('e','ghost','response')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  /**
   * The junction is the reason `reconcileColumns` cannot stop at the parent
   * table. A field added to `linkedDtos`' item object must reach an existing
   * database, or the junction INSERT throws inside `indexAll`'s single rebuild
   * transaction and the project is served from a permanently stale index.
   */
  it('reconciles a column added to the junction on an existing database', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    db.prepare(`INSERT INTO dto (slug, name) VALUES ('d', 'D')`).run();
    db.prepare(`INSERT INTO endpoint (slug, method, path) VALUES ('e', 'GET', '/x')`).run();
    db.prepare(
      `INSERT INTO endpoint_dto (endpoint_slug, dto_slug, relation) VALUES ('e','d','response')`,
    ).run();

    const widened = {
      type: 'endpoint',
      data: {
        ...endpointData,
        schema: {
          ...endpointData.schema,
          linkedDtos: {
            ...(endpointData.schema.linkedDtos as Record<string, unknown>),
            item: {
              kind: 'object',
              fields: {
                ...((endpointData.schema.linkedDtos as { item: { fields: object } }).item.fields),
                note: { kind: 'string' },
              },
            },
          },
        },
      },
    } as (typeof MODULES)[number];

    const result = applyProjection(db, [{ type: 'dto', data: dtoData }, widened]);
    expect(result.alteredColumns).toContain('endpoint_dto.note');
    expect(columnsOf(db, 'endpoint_dto').map((c) => c.name)).toContain('note');
    // The existing row survives — this is an ALTER, not a rebuild.
    expect(db.prepare('SELECT COUNT(*) AS n FROM endpoint_dto').get()).toEqual({ n: 1 });
    db.close();
  });
});
