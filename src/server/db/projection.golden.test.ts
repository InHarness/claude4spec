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
 * SCOPE: the two types this repo contributes directly. Every other type lives
 * in an envelope and is covered by the same assertions in that workspace's own
 * suite (`plugins/<name>/test/projection-golden.test.ts`) — `dto`/`endpoint`
 * since 0.2.2, `ui-view`/`design-system` since 0.2.18. Importing their source
 * here would pull files that import `@c4s/plugin-runtime` into the root TS
 * program, where the specifier resolves to the BUILT `dist/` .d.ts rather than
 * to source, making this file's typecheck depend on build order.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, generateProjectionDDL, type ProjectableModule } from './projection.js';
import { acData } from '../../shared/entities/ac/schema.js';
import { diagramData } from '../../shared/entities/diagram/schema.js';

/**
 * The DDL as the deleted `migrations.ts` files wrote it, carried forward through
 * every DECLARED change since — spelled out here rather than silently
 * regenerated, which is the whole value of the golden.
 *
 * 0.2.22 added `title`, reserved on every type and therefore a column on every
 * projection. 0.2.51 removes `ac.text` and `ac.description`, the two fields that
 * release collapses into `title`. Each such edit has to be made BY HAND, and
 * that is the point: an unexplained diff here is a schema change nobody
 * declared, and the only thing standing between it and a silent
 * `CREATE TABLE IF NOT EXISTS` no-op on an upgraded database is a reviewer
 * reading this file. Everything not named in a release note still has to match
 * what the hand-written migration wrote: order, nullability, defaults, indexes.
 *
 * A removal here also carries a runtime half the addition did not: existing
 * databases keep the retired column until `dropRemovedColumns` takes it, which
 * is exercised further down.
 */
const RETIRED_DDL: Record<string, string> = {
  ac: `
    CREATE TABLE IF NOT EXISTS ac (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'requirement',
      status TEXT NOT NULL DEFAULT 'active',
      verifies TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ac_status ON ac(status);
    CREATE INDEX IF NOT EXISTS idx_ac_kind   ON ac(kind);
  `,
  diagram: `
    CREATE TABLE IF NOT EXISTS diagram (
      slug       TEXT NOT NULL PRIMARY KEY,
      title      TEXT NOT NULL,
      format     TEXT NOT NULL DEFAULT 'mermaid',
      source     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
};

const MODULES: ProjectableModule[] = [
  { type: 'ac', data: acData },
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
    db.prepare(`INSERT INTO ac (slug, title) VALUES ('a', 'something holds')`).run();

    const widened = {
      type: 'ac',
      data: {
        ...acData,
        schema: {
          ...acData.schema,
          reviewedAt: {
            type: 'string',
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

  /**
   * THE MIRROR IMAGE OF ADD COLUMN, and the bug that earned it.
   *
   * A generator that adds but never removes does not compute `schema → DDL`; it
   * computes a function of the database's history, so two installs of one project
   * diverge physically. That is the principled argument. The concrete one is that
   * a stale NOT NULL column BREAKS the next rebuild: the write path binds only
   * declared columns, so the insert fails inside `indexAll`'s single transaction
   * and rolls the whole rebuild back, leaving a permanently stale index.
   *
   * Safe because the projection is derived and the entity files are the truth —
   * the rebuild that follows refills every declared column from them.
   */
  it('drops a column the schema no longer declares', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    db.exec(`ALTER TABLE ac ADD COLUMN legacy_note TEXT NOT NULL DEFAULT ''`);
    const names = () => columnsOf(db, 'ac').map((c) => c.name);
    expect(names()).toContain('legacy_note');

    const result = applyProjection(db, MODULES);
    expect(result.alteredColumns).toContain('ac.legacy_note');
    expect(names()).not.toContain('legacy_note');
    db.close();
  });

  it('a stale NOT NULL column would otherwise make the next write impossible', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    // No DEFAULT: exactly the shape a removed required field leaves behind.
    db.exec(`ALTER TABLE ac ADD COLUMN gone TEXT`);
    db.exec(`UPDATE ac SET gone = 'x'`);
    applyProjection(db, MODULES);
    expect(() =>
      db.prepare(`INSERT INTO ac (slug, title) VALUES ('b', 't')`).run(),
    ).not.toThrow();
    db.close();
  });

  /**
   * SQLite refuses `DROP COLUMN` while an index mentions the column. The index
   * in question is one THIS module created from a `data.access` hint, and the
   * hint that asked for it is gone along with the field, so the index is dead
   * too — dropping it is not a loss, it is the same regeneration.
   */
  it('drops the generated index that would block the column', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    db.exec(`ALTER TABLE ac ADD COLUMN legacy_note TEXT`);
    db.exec(`CREATE INDEX idx_ac_legacy_note ON ac(legacy_note)`);

    applyProjection(db, MODULES);
    expect(columnsOf(db, 'ac').map((c) => c.name)).not.toContain('legacy_note');
    expect(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
        .get('idx_ac_legacy_note'),
    ).toBeUndefined();
    db.close();
  });

  /**
   * A column SQLite will not release keeps the project OPENABLE. This runs at
   * `ProjectContext` construction, so a throw here is not a degraded index —
   * it is a project that will not open, which is worse than the stale column
   * the drop exists to remove.
   */
  it('leaves a column it cannot drop rather than failing the boot', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    // The real table, plus an undeclared column held by a table-level UNIQUE —
    // the one form of constraint only a full table rebuild could rewrite.
    const { sql } = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ac'`)
      .get() as { sql: string };
    db.exec(`DROP TABLE ac`);
    db.exec(sql.replace(/\)\s*$/, ',\n  gone TEXT,\n  UNIQUE(gone)\n)'));

    expect(() => applyProjection(db, MODULES)).not.toThrow();
    expect(columnsOf(db, 'ac').map((c) => c.name)).toContain('gone');
    db.close();
  });

  /**
   * The two exclusions, both the contract's. `slug` is the row's identity and
   * comes from the envelope rather than from `data.schema`; a keyed collection's
   * projection row carries its binding column back to the parent. Neither is a
   * projection of a declared field, and dropping either would take out the
   * junction's own key.
   */
  it('never drops the identity or binding columns', () => {
    const db = new Database(':memory:');
    applyProjection(db, MODULES);
    const before = tablesOf(db).map((t) => [t, columnsOf(db, t)] as const);
    applyProjection(db, MODULES);
    for (const [table, columns] of before) {
      expect(columnsOf(db, table)).toEqual(columns);
      const names = columns.map((c) => c.name);
      if (names.includes('slug')) expect(columnsOf(db, table).map((c) => c.name)).toContain('slug');
    }
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
