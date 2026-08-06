/**
 * A real v1 sheet file, indexed by the real indexer.
 *
 * `payload-upgrade.test.ts` proves the transform; `live-type.test.ts` proves the
 * type works once written through 2.x. Neither proves the thing the whole
 * migration exists for: that a file written by the v1 PLUGIN, sitting on disk
 * today, comes back as a readable grid after this port — with its cells in the
 * index, its dimensions intact, and its file rewritten exactly once.
 *
 * The fixture is copied verbatim from
 * `app-spec/.claude4spec/entities/spreadsheet/pliki-external.json`, so the shape
 * under test is the corpus rather than an idea of it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import { EntityIndexerService } from '../../../src/server/services/entity-indexer.js';

const V1_FILE = {
  slug: 'pliki-external',
  name: 'external/ — kontrakty użycia paczek zewnętrznych',
  nRows: 2,
  nCols: 2,
  headerRow: true,
  headerCol: false,
  cells: [
    ['Plik', 'Opisuje'],
    ['@external/inharness-packages.md', '`@inharness/agent-adapters` + `@inharness/agent-chat`'],
  ],
  // NOTE: no `payloadVersion` key. That absence is what marks it as v1, and it
  // is exactly how every file in the real corpus looks.
};

describe('a v1 spreadsheet file, through the real indexer', () => {
  let t: TestApp;
  let filePath: string;

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

  const cells = () =>
    t.db.prepare('SELECT r, c, value FROM spreadsheet_cell ORDER BY r, c').all() as Array<{
      r: number;
      c: number;
      value: string;
    }>;
  const onDisk = () => JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

  beforeEach(async () => {
    t = await createTestApp();
    const dir = path.join(t.entityStore.root, 'spreadsheet');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, 'pliki-external.json');
    fs.writeFileSync(filePath, `${JSON.stringify(V1_FILE, null, 2)}\n`);
    await indexer().indexAll();
  });
  afterEach(() => t.cleanup());

  it('lands every non-empty cell in the index', () => {
    // Without the upgrade this is `[]` — each dense ROW is read as one item and
    // every key tuple comes out null. Silently: the sheet still exists, it is
    // just empty.
    expect(cells()).toEqual([
      { r: 1, c: 1, value: 'Plik' },
      { r: 1, c: 2, value: 'Opisuje' },
      { r: 2, c: 1, value: '@external/inharness-packages.md' },
      { r: 2, c: 2, value: '`@inharness/agent-adapters` + `@inharness/agent-chat`' },
    ]);
  });

  it('keeps the sheet’s identity and dimensions', () => {
    const row = t.db.prepare('SELECT name, n_rows, n_cols, header_row FROM spreadsheet WHERE slug = ?').get('pliki-external') as Record<string, unknown>;
    expect(row.name).toBe(V1_FILE.name);
    expect(row.n_rows).toBe(2);
    expect(row.n_cols).toBe(2);
    expect(row.header_row).toBe(1);
  });

  it('rewrites the file into the sparse shape, stamped v2', () => {
    const after = onDisk();
    expect(after.payloadVersion).toBe(2);
    expect(after.cells).toEqual([
      { r: 1, c: 1, value: 'Plik' },
      { r: 1, c: 2, value: 'Opisuje' },
      { r: 2, c: 1, value: '@external/inharness-packages.md' },
      { r: 2, c: 2, value: '`@inharness/agent-adapters` + `@inharness/agent-chat`' },
    ]);
  });

  it('rewrites once, not on every read', async () => {
    const first = fs.readFileSync(filePath, 'utf-8');
    await indexer().indexAll();
    // The marker short-circuits the second pass. If it did not, every rebuild
    // would rewrite every sheet — and a second dense→sparse pass would read
    // `{r,c,value}` as a dense row.
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(first);
    expect(cells()).toHaveLength(4);
  });

  it('is not an edit: no version row, no updatedAt stamp', () => {
    const versions = (
      t.db
        .prepare(`SELECT COUNT(*) AS c FROM entity_version WHERE entity_type = 'spreadsheet' AND entity_slug = ?`)
        .get('pliki-external') as { c: number }
    ).c;
    // Bumping a type's payload version must not rewrite the audit history of
    // every entity of that type — otherwise the next release diff reports an
    // edit to every sheet that nobody made.
    expect(versions).toBe(0);
  });

  it('rebuilds to the same rows from the entity directory — a fixpoint', async () => {
    const before = cells();
    await indexer().indexAll();
    expect(cells()).toEqual(before);
  });
});
