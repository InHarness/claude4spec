/**
 * THE REAL CORPUS, THROUGH THE REAL INDEXER, FROM A NON-EMPTY DATABASE.
 *
 * 38 files copied verbatim out of two projects — 22 from `app-spec`, 16 from
 * `zbieram-kaucje` — because they are two genuinely different shapes on disk:
 * every app-spec file carries camelCase `createdAt`/`updatedAt` (two also carry
 * a snake_case pair beside it), and not one zbieram-kaucje file carries any
 * timestamp at all. A fixture invented from memory would have had one shape.
 *
 * WHY THE CORRUPTION PHASE EXISTS. A test that starts from an empty database
 * proves almost nothing here: every write is an INSERT, so the UPDATE arm of
 * the upsert, the reconcile pass that removes rows with no file behind them,
 * and the repair of a partially-written row are all unreached. Adoption is
 * precisely the case where the database is NOT empty. So phase 2 damages the
 * index four different ways and phase 3 asserts the rebuild repairs all four.
 *
 * The expected side of every comparison is read STRAIGHT OFF THE FILES, never
 * derived from the thing under test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import { EntityIndexerService } from '../../../src/server/services/entity-indexer.js';
import { backfillEntityTimestamps } from '../../../src/server/workspace/entity-timestamp-backfill.js';
import { danglingScalarRefs } from '../../../src/server/db/projection-write.js';

/** Measured on the raw corpus — see `fk-normalization.test.ts`, which drives them to 0. */
const EXPECTED_DANGLING: Record<string, number> = { 'app-spec': 9, 'zbieram-kaucje': 15 };

const CORPORA = ['app-spec', 'zbieram-kaucje'] as const;
const fixtureDir = (corpus: string) =>
  path.join(import.meta.dirname, 'fixtures', 'corpus', corpus);

interface Expected {
  name: string;
  columns: number;
  indexes: number;
  createdAt?: string;
  updatedAt?: string;
}

/** What the FILES claim. The half of the comparison the port cannot influence. */
function expectedFromFiles(dir: string): Map<string, Expected> {
  const out = new Map<string, Expected>();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>;
    out.set(f.replace(/\.json$/, ''), {
      name: String(j.name),
      columns: Array.isArray(j.columns) ? j.columns.length : 0,
      indexes: Array.isArray(j.indexes) ? j.indexes.length : 0,
      createdAt: typeof j.createdAt === 'string' ? j.createdAt : undefined,
      updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : undefined,
    });
  }
  return out;
}

describe.each(CORPORA)('the %s corpus, adopted in place', (corpus) => {
  let t: TestApp;
  let dir: string;
  let expected: Map<string, Expected>;

  const indexer = () =>
    new EntityIndexerService(
      t.db,
      t.entityStore,
      (t as unknown as { entitiesWatcher: never }).entitiesWatcher,
      { broadcast: () => {} },
      t.host,
      t.tagsService,
      t.rawReader,
    );

  /**
   * The index side. `columns`/`indexes` are embedded JSON columns, so the count
   * is an ARRAY LENGTH, not a row count — which is exactly the fact a
   * junction-table port would have broken silently.
   */
  const actual = () =>
    new Map(
      (
        t.db
          .prepare('SELECT slug, name, columns, indexes FROM database_table ORDER BY slug')
          .all() as Array<Record<string, string>>
      ).map((r) => [
        r.slug,
        {
          name: r.name,
          columns: (JSON.parse(r.columns) as unknown[]).length,
          indexes: (JSON.parse(r.indexes) as unknown[]).length,
        },
      ]),
    );

  const compare = () => {
    for (const [slug, want] of expected) {
      const got = actual().get(slug);
      expect(got, `missing table ${slug}`).toBeDefined();
      expect({ slug, ...got }).toEqual({
        slug,
        name: want.name,
        columns: want.columns,
        indexes: want.indexes,
      });
    }
  };

  const readAllFiles = () => {
    const out: Record<string, string> = {};
    for (const f of fs.readdirSync(dir).sort()) out[f] = fs.readFileSync(path.join(dir, f), 'utf-8');
    return out;
  };

  beforeEach(async () => {
    t = await createTestApp();
    expected = expectedFromFiles(fixtureDir(corpus));
    dir = path.join(t.entityStore.root, 'database-table');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(fixtureDir(corpus)).filter((n) => n.endsWith('.json'))) {
      fs.copyFileSync(path.join(fixtureDir(corpus), f), path.join(dir, f));
    }
    /**
     * EXACTLY WHAT BOOT DOES, and the reason the corpus is a fixpoint at all.
     *
     * `project-context` runs this once, BEFORE `indexAll`, and it writes the
     * FILES — an unstamped file gets a real `createdAt` from the ladder
     * (`entity_version` → git author date → mtime → one shared epoch
     * placeholder) rather than a fresh `now`. Omitting it here is not a
     * simplification: 16 of these 38 files carry no timestamp, so without the
     * backfill every rebuild mints a new `now` for them and the fixpoint
     * assertion below fails by milliseconds. That failure is real, and it is
     * what this line is the fix for in production too.
     */
    backfillEntityTimestamps(t.db, t.entityStore, t.cwd, '.claude4spec/entities');
    await indexer().indexAll();
  });
  afterEach(() => t.cleanup());

  // ─── phase 1 — every table is readable, with its counts intact ─────────────

  it('indexes every file, with per-table column and index counts preserved', () => {
    expect(actual().size).toBe(expected.size);
    compare();
  });

  // ─── phase 2+3 — repair, over a NON-EMPTY, damaged index ──────────────────

  it('repairs a damaged index rather than only filling an empty one', async () => {
    const slugs = [...expected.keys()].sort();
    const [emptied, renamed, deleted] = [slugs[0], slugs[1], slugs[2]];

    // (a) a stale row whose collections were emptied — does the UPDATE arm refill?
    t.db
      .prepare(`UPDATE database_table SET columns = '[]', indexes = '[]' WHERE slug = ?`)
      .run(emptied);
    // (b) a stale row carrying the wrong name — does the update overwrite, or only insert?
    t.db.prepare(`UPDATE database_table SET name = 'stale_name' WHERE slug = ?`).run(renamed);
    // (c) a missing row — is it recreated, or skipped as already-known?
    t.db.prepare(`DELETE FROM database_table WHERE slug = ?`).run(deleted);
    // (d) an orphan with no file behind it — does the reconcile pass remove it?
    t.db
      .prepare(
        `INSERT INTO database_table (slug, name, columns, indexes, created_at, updated_at)
         VALUES ('ghost-table', 'ghost', '[]', '[]', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
      )
      .run();

    await indexer().indexAll();

    compare();
    expect(actual().has('ghost-table')).toBe(false);
    expect(actual().size).toBe(expected.size);
  });

  // ─── phase 4 — fixpoint, in BOTH directions ──────────────────────────────

  it('is a fixpoint: a second rebuild moves neither the rows nor the file bytes', async () => {
    const rowsBefore = t.db.prepare('SELECT * FROM database_table ORDER BY slug').all();
    const filesBefore = readAllFiles();

    await indexer().indexAll();

    expect(t.db.prepare('SELECT * FROM database_table ORDER BY slug').all()).toEqual(rowsBefore);
    // The file half is what makes the timestamp question empirical rather than
    // an argument: if anything were being re-stamped, `updatedAt` would move.
    expect(readAllFiles()).toEqual(filesBefore);
  });

  // ─── phase 5 — timestamps, asserted rather than reasoned about ────────────

  it('preserves a file’s own timestamps verbatim, and never regenerates them', () => {
    const stamped = [...expected].filter(([, e]) => e.createdAt && e.updatedAt);
    for (const [slug, want] of stamped) {
      const row = t.db
        .prepare('SELECT created_at, updated_at FROM database_table WHERE slug = ?')
        .get(slug) as { created_at: string; updated_at: string };
      expect(row.created_at, slug).toBe(want.createdAt);
      expect(row.updated_at, slug).toBe(want.updatedAt);
    }
  });

  it('gives an unstamped file a real timestamp, never the epoch and never blank', () => {
    const unstamped = [...expected].filter(([, e]) => !e.createdAt);
    for (const [slug] of unstamped) {
      const row = t.db
        .prepare('SELECT created_at, updated_at FROM database_table WHERE slug = ?')
        .get(slug) as { created_at: string; updated_at: string };
      expect(row.created_at, slug).toBeTruthy();
      expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
    }
  });

  it('is not an edit: indexing the corpus writes no version rows', () => {
    const n = (
      t.db
        .prepare(`SELECT COUNT(*) AS c FROM entity_version WHERE entity_type = 'database-table'`)
        .get() as { c: number }
    ).c;
    expect(n).toBe(0);
  });
});

/**
 * PHASE 6 — the soft FK, measured on the real corpus through the host's own
 * checker rather than through a re-implementation of it.
 *
 * This is the reward the `ref` declaration buys, and it is only a reward if it
 * actually fires: before the shape-driven walk, a ref three layers inside an
 * embedded collection was invisible and every one of these wrote clean.
 */
describe.each(CORPORA)('%s — soft foreign keys', (corpus) => {
  let t: TestApp;

  const indexer = () =>
    new EntityIndexerService(
      t.db,
      t.entityStore,
      (t as unknown as { entitiesWatcher: never }).entitiesWatcher,
      { broadcast: () => {} },
      t.host,
      t.tagsService,
      t.rawReader,
    );

  beforeEach(async () => {
    t = await createTestApp();
    const dir = path.join(t.entityStore.root, 'database-table');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(fixtureDir(corpus)).filter((n) => n.endsWith('.json'))) {
      fs.copyFileSync(path.join(fixtureDir(corpus), f), path.join(dir, f));
    }
    backfillEntityTimestamps(t.db, t.entityStore, t.cwd, '.claude4spec/entities');
    await indexer().indexAll();
  });
  afterEach(() => t.cleanup());

  const module = () => t.host.getEntity('database-table')!;

  const warningsFor = (slug: string) => {
    const file = JSON.parse(
      fs.readFileSync(path.join(t.entityStore.root, 'database-table', `${slug}.json`), 'utf-8'),
    ) as Record<string, unknown>;
    return danglingScalarRefs(t.db, module() as never, slug, file);
  };

  const allWarnings = () =>
    fs
      .readdirSync(path.join(t.entityStore.root, 'database-table'))
      .filter((n) => n.endsWith('.json'))
      .flatMap((n) => warningsFor(n.replace(/\.json$/, '')));

  it('reports exactly the references the corpus really has broken', () => {
    expect(allWarnings()).toHaveLength(EXPECTED_DANGLING[corpus]);
  });

  it('names the path and the missing target, not just the entity', () => {
    const [first] = allWarnings();
    // The path is what makes a warning actionable in a 30-column table.
    expect(first).toMatch(/columns\[\d+\]\.fk\.table references database-table '.+' \(dangling\)|columns\[\d+\]\.fk\.table references database-table '.+', which does not exist/);
  });

  it('warns without dropping anything — every table is still indexed', () => {
    // `onMissing: 'warn'` never blocks. A dangling fk must not cost a table.
    const n = (t.db.prepare('SELECT COUNT(*) AS c FROM database_table').get() as { c: number }).c;
    expect(n).toBe(fs.readdirSync(fixtureDir(corpus)).filter((x) => x.endsWith('.json')).length);
  });
});
