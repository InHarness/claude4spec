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
 * One intentional difference is asserted as such rather than normalized away, so
 * it cannot drift into being accidental: the `slug` PK gains `NOT NULL` on the
 * tables that lacked it.
 *
 * SCOPE: the four types this repo contributes directly. `dto` and `endpoint`
 * live in the api-contracts envelope and are covered by the same assertions in
 * that workspace's own suite (`test/projection-golden.test.ts`) — importing
 * their source here would pull files that import `@c4s/plugin-runtime` into the
 * root TS program, where the specifier resolves to the BUILT `dist/` .d.ts
 * rather than to source, making this file's typecheck depend on build order.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, generateProjectionDDL, type ProjectableModule } from './projection.js';
import { acData } from '../../shared/entities/ac/schema.js';
import { uiViewData } from '../../shared/entities/ui-view/schema.js';
import { designSystemData } from '../../shared/entities/design-system/schema.js';
import { diagramData } from '../../shared/entities/diagram/schema.js';

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
};

const MODULES: ProjectableModule[] = [
  { type: 'ac', data: acData },
  { type: 'ui-view', data: uiViewData },
  { type: 'design-system', data: designSystemData },
  { type: 'diagram', data: diagramData },
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
  for (const type of Object.keys(RETIRED_DDL)) db.exec(RETIRED_DDL[type] as string);
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
  });
});

describe('projection generator — reconciling an existing database', () => {
  /**
   * `ALTER TABLE ADD COLUMN` accepts only a CONSTANT default. `DEFAULT
   * (datetime('now'))` is fine in a CREATE and rejected by an ALTER the moment
   * the table holds a row — and `computedDefault: 'now'` is the flag the schema
   * contract documents for timestamps, so it is the likely case rather than the
   * exotic one. Emitting it would have made every POPULATED project fail to open
   * while every fresh install worked.
   */
  it('adds a computedDefault column to a POPULATED table without a non-constant default', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    db.prepare(`INSERT INTO ac (slug, text) VALUES ('a', 'something holds')`).run();

    const widened = {
      type: 'ac',
      data: {
        ...acData,
        schema: {
          ...acData.schema,
          reviewedAt: {
            kind: 'string',
            column: 'reviewed_at',
            systemManaged: true,
            computedDefault: 'now',
          },
        },
      },
    } as ProjectableModule;

    let result!: ReturnType<typeof applyProjection>;
    expect(() => {
      result = applyProjection(db, [widened]);
    }).not.toThrow();
    expect(result.alteredColumns).toContain('ac.reviewed_at');

    // The column arrives NULL on the existing row; `indexAll()` fills it from
    // the file immediately afterwards, the same path a new NOT NULL field takes.
    expect(db.prepare('SELECT reviewed_at FROM ac WHERE slug = ?').get('a')).toEqual({
      reviewed_at: null,
    });
    db.close();
  });

  it('is a no-op on a database that already matches', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    expect(applyProjection(db, MODULES)).toEqual({ created: [], alteredColumns: [] });
    db.close();
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
