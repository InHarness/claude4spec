import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { PagesService } from './pages.js';
import { SectionIndexerService } from './section-indexer.js';
import { parseSections } from '../../shared/section-parser.js';
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

  /**
   * 0.2.101 — a root rename rebuilds the index under the new id. The section row
   * moves (ON CONFLICT(anchor)), and its links must move with it: rows left
   * under the old id would keep reporting an edge the page no longer has.
   */
  it('re-indexing under a renamed root leaves no link behind under the old id', async () => {
    existing.add('ac|kept');
    existing.add('ac|removed');
    await pages.write('doc.md', {
      body: [
        '<!-- anchor: aaaaaa11 -->',
        '# Top',
        '',
        '<single_element type="ac" slug="kept"/>',
        '<single_element type="ac" slug="removed"/>',
        '',
      ].join('\n'),
    });
    await indexer.indexPage('pages', 'doc.md');
    expect(links()).toEqual(['ac|kept', 'ac|removed']);

    // The successor context: same directory, mounted under the new id.
    const renamed = new PagesService(cwd, 'pages', 'docs');
    const successor = new SectionIndexerService(db, new Map([['docs', { pages: renamed }]]), { broadcast: () => {} } as never, host);
    await renamed.write('doc.md', {
      body: ['<!-- anchor: aaaaaa11 -->', '# Top', '', '<single_element type="ac" slug="kept"/>', ''].join('\n'),
    });
    await successor.indexPage('docs', 'doc.md');

    expect(links()).toEqual(['ac|kept']);
    const roots = db.prepare('SELECT DISTINCT rootId FROM section_entity_link').all() as Array<{ rootId: string }>;
    expect(roots.map((r) => r.rootId)).toEqual(['docs']);
  });

  /**
   * 2.1.8 (M06 `s2r014vw`) — the indexer is an 8-step pass with no injection
   * step: a heading without an anchor is neither written to disk nor indexed by
   * it. `m06-anchor-injection` (write-back) gives it one; the next indexer pass
   * then indexes it. The full rebuild runs the two in that order per file.
   */
  it('section indexer injects no anchor — m06-anchor-injection does, before the pass (s2r014vw)', async () => {
    const body = ['<!-- anchor: aaaaaa11 -->', '# Top', '', '## New', 'text', ''].join('\n');
    await pages.write('doc.md', { body });

    await indexer.indexPage('pages', 'doc.md');
    expect((await pages.read('doc.md')).body).toBe(body);
    const indexed = () =>
      (db.prepare('SELECT heading_text FROM section_index ORDER BY line_start').all() as Array<{ heading_text: string }>).map(
        (r) => r.heading_text,
      );
    expect(indexed()).toEqual(['Top']);

    expect(await indexer.mintAnchors('pages', 'pages:pages', 'doc.md', () => {})).toBe(true);
    const anchored = parseSections((await pages.read('doc.md')).body, { frontmatter: false }).sections;
    expect(anchored.map((s) => s.anchor)).toEqual(['aaaaaa11', expect.stringMatching(/^[a-z0-9]{8}$/)]);
    await indexer.indexPage('pages', 'doc.md');
    expect(indexed()).toEqual(['Top', 'New']);
  });

  it('full rebuild with suppress runs m06-anchor-injection before indexing each file (s2r014vw)', async () => {
    await pages.write('doc.md', { body: ['# Top', '', 'text', ''].join('\n') });
    const suppressed: string[] = [];
    await indexer.indexAll((source, relPath) => suppressed.push(`${source}|${relPath}`));
    expect(suppressed).toEqual(['pages:pages|doc.md']);
    const row = db.prepare('SELECT anchor FROM section_index WHERE heading_text = ?').get('Top') as
      | { anchor: string }
      | undefined;
    expect(row?.anchor).toMatch(/^[a-z0-9]{8}$/);
    expect((await pages.read('doc.md')).body).toContain(`<!-- anchor: ${row!.anchor} -->`);
  });

  it('does not treat a # line inside a fenced code block as a heading', () => {
    const { sections } = parseSections(
      ['<!-- anchor: aaaaaa11 -->', '# Top', '', '```sh', '# not a heading', '```', '', '## Real', ''].join('\n'),
    );
    expect(sections.map((h) => h.heading)).toEqual(['Top', 'Real']);
  });
});
