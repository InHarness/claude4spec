import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { PagesService } from './pages.js';
import { SectionIndexerService, parseHeadings } from './section-indexer.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

/**
 * 0.2.89 — the integrity `section_entity_link` does not get from its schema, and
 * the headings the indexer must not see.
 *
 * The anchor side of an edge is a real FK (`ON DELETE CASCADE`); the entity side
 * is not, because `entity_type` follows the project's active type registry. So an
 * entity that goes away leaves its edges behind until an indexer pass notices.
 */
describe('section index integrity', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let indexer: SectionIndexerService;
  const existing = new Set<string>();

  const host = {
    listEntities: () => [],
    listAvailable: () => [],
    getEntity: () => null,
    getAvailable: () => null,
    isActive: () => true,
    entityExists: (type: string, slug: string) => existing.has(`${type}|${slug}`),
    getEntityService: () => null,
  } as unknown as ProjectPluginHost;

  beforeEach(async () => {
    existing.clear();
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-section-integrity-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    indexer = new SectionIndexerService(db, new Map([['pages', { pages }]]), { broadcast: () => {} } as never, host);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  function links(): string[] {
    const rows = db
      .prepare('SELECT entity_type, entity_slug FROM section_entity_link ORDER BY entity_type, entity_slug')
      .all() as Array<{ entity_type: string; entity_slug: string }>;
    return rows.map((r) => `${r.entity_type}|${r.entity_slug}`);
  }

  it('links any type the registry knows — not a closed list of five', async () => {
    existing.add('mcp-tool|get_sections');
    existing.add('module-dependency|m06-m42');
    await pages.write(
      'doc.md',
      {
        body: [
          '<!-- anchor: aaaaaa11 -->',
          '# Top',
          '',
          '<single_element type="mcp-tool" slug="get_sections"/>',
          '<single_element type="module-dependency" slug="m06-m42"/>',
          '',
        ].join('\n'),
      },
    );
    await indexer.indexPage('pages', 'doc.md');

    expect(links()).toEqual(['mcp-tool|get_sections', 'module-dependency|m06-m42']);
  });

  it('prunes an edge whose entity is gone, on the full pass, without touching live ones', async () => {
    existing.add('ac|stays');
    existing.add('ac|goes');
    await pages.write('doc.md', {
      body: [
        '<!-- anchor: aaaaaa11 -->',
        '# Top',
        '',
        '<single_element type="ac" slug="stays"/>',
        '<single_element type="ac" slug="goes"/>',
        '',
      ].join('\n'),
    });
    await indexer.indexPage('pages', 'doc.md');
    expect(links()).toEqual(['ac|goes', 'ac|stays']);

    existing.delete('ac|goes');
    expect(indexer.pruneDanglingEntityLinks()).toBe(1);
    expect(links()).toEqual(['ac|stays']);
  });

  it('drops a section edge with its section — the anchor side cascades', async () => {
    existing.add('ac|stays');
    await pages.write('doc.md', {
      body: ['<!-- anchor: aaaaaa11 -->', '# Top', '', '<single_element type="ac" slug="stays"/>', ''].join('\n'),
    });
    await indexer.indexPage('pages', 'doc.md');
    expect(links()).toEqual(['ac|stays']);

    db.prepare('DELETE FROM section_index WHERE anchor = ?').run('aaaaaa11');

    expect(links()).toEqual([]);
  });

  it('does not treat a # line inside a fenced code block as a heading', () => {
    const headings = parseHeadings(
      ['<!-- anchor: aaaaaa11 -->', '# Top', '', '```sh', '# not a heading', '```', '', '## Real', ''].join('\n').split('\n'),
    );
    expect(headings.map((h) => h.text)).toEqual(['Top', 'Real']);
  });
});
