/**
 * The envelope's half of the Host API 2.0.0 de-risking test.
 *
 * `src/server/db/projection.golden.test.ts` keeps the retired DDL for the two
 * types the host still contributes directly (`ac`, `diagram`). `ui-view` and
 * `design-system` live here as of 0.2.18, and their assertions live here with
 * them — importing this package's source into the root test program would pull
 * files that import `@c4s/plugin-runtime` into it, where the specifier resolves
 * to the BUILT `dist/` .d.ts rather than to source, so the root typecheck would
 * silently depend on build order. Same reasoning, same shape, as
 * `c4s-plugin-api-contracts/test/projection-golden.test.ts`.
 *
 * The claim is unchanged by the move: every database on disk was built by the
 * OLD statements and every new one by the generated ones, and
 * `CREATE TABLE IF NOT EXISTS` makes any disagreement silent. So the retired SQL
 * is frozen below and the two schemas are compared column by column, in order.
 *
 * `ui_view.design_system_slug` is LAST, and that is load-bearing: the historical
 * chain appended it via `ALTER TABLE` in migration 037, and this comparison is
 * positional.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, generateProjectionDDL } from '../../../src/server/db/projection.js';
import { uiViewData } from '../src/entity/ui-view/schema.js';
import { designSystemData } from '../src/entity/design-system/schema.js';

/**
 * The DDL as the deleted `migrations.ts` files wrote it, byte for byte — plus the
 * columns added since, each of which has to be added here deliberately.
 *
 * `ui_view.mockup_html` (0.2.27) is one of those: `contentBearing` excludes a
 * field from READS, not from the projection, so the column exists exactly as the
 * diagram's `source` does. Nullable, because a mockup is optional and clearable.
 */
const RETIRED_DDL: Record<string, string> = {
  'ui-view': `
    CREATE TABLE IF NOT EXISTS ui_view (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT,
      description TEXT,
      params TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      design_system_slug TEXT,
      mockup_html TEXT
    );
  `,
  'design-system': `
    CREATE TABLE IF NOT EXISTS design_system (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      groups      TEXT NOT NULL DEFAULT '[]',
      modes       TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
};

const MODULES = [
  { type: 'design-system', data: designSystemData },
  { type: 'ui-view', data: uiViewData },
] as unknown as Parameters<typeof applyProjection>[1];

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
       * generator always writes `NOT NULL`. In SQLite that is not redundant: a
       * `TEXT PRIMARY KEY` column accepts NULL, a long-standing compatibility
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

  /**
   * `designSystemSlug` declares `ref: 'design-system'` with
   * `onDelete: 'leave-dangling'` — so it is a plain nullable TEXT column and
   * emphatically NOT a foreign key. A generator that turned every `ref` into an
   * FK would make a dangling reference impossible to store, which is the exact
   * behaviour `onMissing: 'warn'` exists to allow.
   */
  it('the ref column is a plain column — no foreign key, no index', () => {
    const db = generatedDb();
    expect(db.prepare('PRAGMA foreign_key_list(ui_view)').all()).toEqual([]);
    const created = (
      db.prepare('PRAGMA index_list(ui_view)').all() as Array<{ origin: string }>
    ).filter((i) => i.origin === 'c');
    expect(created).toEqual([]);
  });

  it('is a pure function of the declaration', () => {
    expect(generateProjectionDDL(MODULES)).toEqual(generateProjectionDDL(MODULES));
  });

  it('applying twice leaves the schema unchanged', () => {
    const db = generatedDb();
    const before = columnsOf(db, 'ui_view');
    applyProjection(db, MODULES);
    expect(columnsOf(db, 'ui_view')).toEqual(before);
  });
});
