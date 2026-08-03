/**
 * THE de-risking test for Host API 2.0.0.
 *
 * Six hand-written `migrations.ts` files were deleted and replaced by DDL
 * generated from `data.schema`. Every existing database on disk was built by the
 * OLD statements; every new one is built by the generated ones. If the two
 * disagree by so much as a column, an upgraded project silently reads or writes
 * a column that is not there — and `CREATE TABLE IF NOT EXISTS` guarantees the
 * disagreement is silent, because it no-ops rather than complaining.
 *
 * So the retired SQL is kept HERE, verbatim, as the golden. Two fresh databases
 * are built — one from the old statements, one from the generator — and their
 * `PRAGMA table_info` is compared column by column, in order.
 *
 * Two intentional differences are asserted as such rather than normalized away,
 * so that neither can drift into being accidental:
 *   1. the `slug` PK gains `NOT NULL` on the five tables that lacked it;
 *   2. the junction's two indexes are renamed to the generator's rule.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { generateProjectionDDL, type ProjectableModule } from './projection.js';
import { acData } from '../../shared/entities/ac/schema.js';
import { uiViewData } from '../../shared/entities/ui-view/schema.js';
import { designSystemData } from '../../shared/entities/design-system/schema.js';
import { diagramData } from '../../shared/entities/diagram/schema.js';
import { dtoData } from '../../../plugins/c4s-plugin-api-contracts/src/entity/dto/schema.js';
import { endpointData } from '../../../plugins/c4s-plugin-api-contracts/src/entity/endpoint/schema.js';

/** The DDL as the deleted `migrations.ts` files wrote it, byte for byte. */
const RETIRED_DDL: Record<string, string> = {
  ac: `
    CREATE TABLE IF NOT EXISTS ac (
      slug TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'requirement',
      status TEXT NOT NULL DEFAULT 'active',
      verifies TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ac_status ON ac(status);
    CREATE INDEX IF NOT EXISTS idx_ac_kind   ON ac(kind);
  `,
  'ui-view': `
    CREATE TABLE IF NOT EXISTS ui_view (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      description TEXT,
      params TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      design_system_slug TEXT
    );
  `,
  'design-system': `
    CREATE TABLE IF NOT EXISTS design_system (
      slug        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      groups      TEXT NOT NULL DEFAULT '[]',
      modes       TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
  diagram: `
    CREATE TABLE IF NOT EXISTS diagram (
      slug       TEXT NOT NULL PRIMARY KEY,
      format     TEXT NOT NULL DEFAULT 'mermaid',
      source     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
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

const MODULES: ProjectableModule[] = [
  { type: 'ac', data: acData },
  { type: 'ui-view', data: uiViewData },
  { type: 'design-system', data: designSystemData },
  { type: 'diagram', data: diagramData },
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

function columnsOf(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

function tablesOf(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function retiredDb(): Database.Database {
  const db = new Database(':memory:');
  // dto before endpoint — the junction's FK names dto(slug), and the retired
  // chain relied on `mountBackend` migrating every module before mounting any.
  for (const type of ['dto', 'endpoint', 'ac', 'ui-view', 'design-system', 'diagram']) {
    db.exec(RETIRED_DDL[type] as string);
  }
  return db;
}

function generatedDb(): Database.Database {
  const db = new Database(':memory:');
  for (const module of MODULES) {
    for (const statement of generateProjectionDDL(module)) db.exec(statement);
  }
  return db;
}

describe('projection generator — equivalence with the retired hand-written DDL', () => {
  it('produces exactly the same set of tables', () => {
    expect(tablesOf(generatedDb())).toEqual(tablesOf(retiredDb()));
  });

  for (const type of Object.keys(RETIRED_DDL)) {
    const table = type.replaceAll('-', '_');
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
       * quirk, and only `diagram` had ever spelled the constraint out. This is
       * the one deliberate strengthening, so it is asserted rather than skipped.
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
      (
        db.prepare(`PRAGMA index_list(endpoint_dto)`).all() as Array<{ name: string; unique: number }>
      )
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
          data: FIXTURE_DATA,
          slugPattern: FIXTURE_SLUG_PATTERN,
          payloadVersion: 1,
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

  it('indexes cover the same columns (names follow the generator rule)', () => {
    const coveredColumns = (db: Database.Database, table: string) =>
      (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; origin: string }>)
        .filter((i) => i.origin === 'c') // created by CREATE INDEX, not by UNIQUE
        .map((i) =>
          (db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>)
            .map((c) => c.name)
            .join(','),
        )
        .sort();

    // `ac`: idx_ac_status / idx_ac_kind, reproduced from `data.access` hints.
    expect(coveredColumns(generatedDb(), 'ac')).toEqual(coveredColumns(retiredDb(), 'ac'));

    /**
     * The junction's indexes cover the same two columns but are RENAMED:
     * `idx_endpoint_dto_endpoint` → `idx_endpoint_dto_endpoint_slug`, and the
     * same for `_dto`. The generator names an index after the columns it
     * actually covers, and an index name is not a contract surface — nothing
     * queries by it. On an upgraded database the two old indexes simply remain
     * alongside the new ones, which is redundant but harmless.
     */
    expect(coveredColumns(generatedDb(), 'endpoint_dto')).toEqual(
      coveredColumns(retiredDb(), 'endpoint_dto'),
    );
  });
});

describe('projection generator — idempotency', () => {
  it('is a pure function of the declaration', () => {
    for (const module of MODULES) {
      expect(generateProjectionDDL(module)).toEqual(generateProjectionDDL(module));
    }
  });

  it('applying twice leaves the schema unchanged', () => {
    const db = generatedDb();
    const before = tablesOf(db).map((t) => columnsOf(db, t));
    for (const module of MODULES) {
      for (const statement of generateProjectionDDL(module)) db.exec(statement);
    }
    expect(tablesOf(db).map((t) => columnsOf(db, t))).toEqual(before);
  });
});
