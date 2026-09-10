/**
 * The envelope's half of the Host API 2.0.0 de-risking test.
 *
 * `src/server/db/projection.golden.test.ts` keeps the retired DDL for the ONE
 * type the host still contributes directly (`diagram`). `ac` lives here as of
 * 0.2.80, and its assertions live here with it — importing this package's source
 * into the root test program would pull files that import `@c4s/plugin-runtime`
 * into it, where the specifier resolves to the BUILT `dist/` .d.ts rather than to
 * source, so the root typecheck would silently depend on build order. Same
 * reasoning and same shape as the api-contracts and frontend-mockups copies.
 *
 * The claim is unchanged by the move: every database on disk was built by the
 * OLD statements and every new one by the generated ones, and
 * `CREATE TABLE IF NOT EXISTS` makes any disagreement silent. So the retired SQL
 * is frozen below and the two schemas are compared column by column, IN ORDER —
 * which is why the field order in `entity/ac/schema.ts` is load-bearing and was
 * preserved byte-for-byte across the extraction.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, generateProjectionDDL } from '../../../src/server/db/projection.js';
import { acData } from '../src/entity/ac/schema.js';

/**
 * The DDL as the retired `025_ac.sql` migration wrote it, byte for byte.
 *
 * The migration itself stays in `src/server/db/migrations/`: it is applied
 * history, replayed verbatim by every installed database, and editing one would
 * change the past. Only this COPY of it travelled, because it is the thing the
 * assertion compares against.
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
};

const MODULES = [{ type: 'ac', data: acData }] as unknown as Parameters<typeof applyProjection>[1];

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function retiredDb(): Database.Database {
  const db = new Database(':memory:');
  for (const sql of Object.values(RETIRED_DDL)) db.exec(sql);
  return db;
}

function generatedDb(): Database.Database {
  const db = new Database(':memory:');
  applyProjection(db, MODULES);
  return db;
}

const tablesOf = (db: Database.Database): string[] =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);

const columnsOf = (db: Database.Database, table: string): ColumnInfo[] =>
  db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];

describe('projection generator — equivalence with the retired hand-written DDL', () => {
  it('produces exactly the same set of tables', () => {
    expect(tablesOf(generatedDb())).toEqual(tablesOf(retiredDb()));
  });

  it('ac: same columns, same order, same types and defaults', () => {
    const before = columnsOf(retiredDb(), 'ac');
    const after = columnsOf(generatedDb(), 'ac');

    expect(after.map((c) => c.name)).toEqual(before.map((c) => c.name));
    expect(after.map((c) => c.type)).toEqual(before.map((c) => c.type));
    expect(after.map((c) => c.dflt_value)).toEqual(before.map((c) => c.dflt_value));
    expect(after.map((c) => c.pk)).toEqual(before.map((c) => c.pk));

    /**
     * Nullability matches everywhere EXCEPT the primary key, which the generator
     * always writes `NOT NULL`. In SQLite that is not redundant: a
     * `TEXT PRIMARY KEY` column accepts NULL, a long-standing compatibility
     * quirk. The one deliberate strengthening, asserted rather than skipped.
     */
    for (const [i, col] of after.entries()) {
      const golden = before[i] as ColumnInfo;
      if (col.pk === 1) {
        expect(col.notnull, `ac.${col.name} PK must be NOT NULL`).toBe(1);
        continue;
      }
      expect(col.notnull, `ac.${col.name} nullability`).toBe(golden.notnull);
    }
  });

  /** `idx_ac_status` / `idx_ac_kind`, reproduced from the `data.access` hints. */
  it('covers the same columns with indexes as the retired migration', () => {
    const coveredColumns = (db: Database.Database) =>
      (db.prepare(`PRAGMA index_list(ac)`).all() as Array<{ name: string; origin: string }>)
        .filter((i) => i.origin === 'c')
        .map((i) =>
          (db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>)
            .map((c) => c.name)
            .join(','),
        )
        .sort();

    expect(coveredColumns(generatedDb())).toEqual(coveredColumns(retiredDb()));
  });

  /**
   * `verifies[].slug` declares `ref: '$type'` with `onDelete: 'leave-dangling'`,
   * and the collection is embedded JSON with no `keyFields` — so `verifies` is a
   * plain TEXT column and emphatically NOT a foreign key or a table of its own.
   * A generator that projected it would break every reader that goes through
   * `entity.data.verifies`, and one that turned the ref into an FK would make a
   * dangling reference impossible to store, which is exactly what
   * `onMissing: 'warn'` exists to allow.
   */
  it('verifies is an embedded column — no side table, no foreign key', () => {
    const db = generatedDb();
    expect(tablesOf(db)).toEqual(['ac']);
    expect(db.prepare('PRAGMA foreign_key_list(ac)').all()).toEqual([]);
    expect(columnsOf(db, 'ac').map((c) => c.name)).toContain('verifies');
  });

  it('is a pure function of the declaration', () => {
    expect(generateProjectionDDL(MODULES)).toEqual(generateProjectionDDL(MODULES));
  });

  it('applying twice leaves the schema unchanged', () => {
    const db = generatedDb();
    const before = columnsOf(db, 'ac');
    applyProjection(db, MODULES);
    expect(columnsOf(db, 'ac')).toEqual(before);
  });
});
