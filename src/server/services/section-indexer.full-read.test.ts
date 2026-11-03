/**
 * 2.1.65 — the M06 section indexer (section parser + entity auto-link) reads
 * the whole page, and takes its non-content ranges from the M51 scanner the
 * same way for `.md` and `.mdx`.
 *
 * Driven through the real `SectionIndexerService` with the anchor injection
 * running first, as in production (see `discovery/section-indexing.test.ts`).
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { SectionIndexerService } from './section-indexer.js';
import { PagesService } from './pages.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { WatchSubscriber } from '../fs/watcher.js';

/** Every `widget` whose slug starts with `w-` exists — enough for the auto-link to persist a row. */
const host = {
  listEntities: () => [],
  listAvailable: () => [],
  getEntity: () => null,
  getAvailable: () => null,
  isActive: () => false,
  entityExists: (type: string, slug: string) => type === 'widget' && slug.startsWith('w-'),
  getEntityService: () => null,
} as unknown as ProjectPluginHost;

const MIB = 1024 * 1024;

describe('M06 section indexer — whole page, M51 ranges (2.1.65)', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let indexer: SectionIndexerService | undefined;
  let injection: WatchSubscriber | undefined;

  beforeEach(async () => {
    indexer = undefined;
    injection = undefined;
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-section-full-read-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function index(relPath: string, content: string): Promise<void> {
    await pages.write(relPath, { body: content });
    indexer ??= new SectionIndexerService(
      db,
      new Map([['pages', { pages }]]),
      { broadcast: () => {} } as never,
      host,
    );
    injection ??= indexer.anchorInjectionSubscriber(() => {});
    // write-back (anchor injection) first, then the projection — production order.
    await injection.onChange('context:test', 'pages:pages', relPath, 'external');
    await indexer.indexPage('pages', relPath);
  }

  function rowsOf(relPath: string): Array<{ anchor: string; heading_text: string; body: string; line_end: number }> {
    return db
      .prepare('SELECT anchor, heading_text, body, line_end FROM section_index WHERE page_path = ? ORDER BY line_start')
      .all(relPath) as Array<{ anchor: string; heading_text: string; body: string; line_end: number }>;
  }

  function linkedSlugs(): string[] {
    return (
      db.prepare(`SELECT entity_slug FROM section_entity_link WHERE entity_type = 'widget' ORDER BY entity_slug`).all() as Array<{
        entity_slug: string;
      }>
    ).map((r) => r.entity_slug);
  }

  it('[ac:m06-indexer-no-size-limit] the last section of a prose-only page over 1 MiB in UTF-8 bytes is in the section index', async () => {
    const lines: string[] = ['# Duża strona', ''];
    const prose = 'Zażółć gęślą jaźń — zwykła proza bez kodu i bez znaczników, wiersz numer';
    let section = 0;
    while (Buffer.byteLength(lines.join('\n'), 'utf8') <= MIB + 4096) {
      lines.push(`## Sekcja ${++section}`, '');
      for (let i = 0; i < 400; i++) lines.push(`${prose} ${section}.${i}.`);
      lines.push('');
    }
    lines.push('## Ostatnia sekcja', '', 'Zdanie zamykające stronę.', '');
    const body = lines.join('\n');
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MIB);
    expect(body).not.toMatch(/[`<]/);

    await index('huge.md', body);

    const rows = rowsOf('huge.md');
    // Every heading made a section — the top one, each `## Sekcja N`, and the last.
    expect(rows).toHaveLength(section + 2);
    const last = rows[rows.length - 1]!;
    expect(last.heading_text).toBe('Ostatnia sekcja');
    expect(last.body).toContain('Zdanie zamykające stronę.');
    // Its own body runs to the end of the page as written (anchor lines included).
    const written = (await pages.read('huge.md')).body.split('\n');
    expect(last.line_end).toBeGreaterThanOrEqual(written.length - 1);
  });

  it('[ac:ac-pliki-mdx-sa-indeksowane-jak-md-ale-s] a heading, an anchor and an entity reference inside an unknown JSX region stay out of section_index and section_entity_link, in .md and .mdx alike', async () => {
    const page = (ext: string, anchor: string) =>
      [
        '# Strona',
        '',
        '<Callout>',
        `<!-- anchor: ${anchor} -->`,
        '## Wewnątrz JSX',
        `Tu <inline_mention type="widget" slug="w-in-${ext}"/> w regionie.`,
        '</Callout>',
        '',
        `Poza regionem <inline_mention type="widget" slug="w-out-${ext}"/>.`,
        '',
      ].join('\n');

    await index('page.md', page('md', 'jsxmd001'));
    await index('page.mdx', page('mdx', 'jsxmdx01'));

    for (const [rel, ext, anchor] of [
      ['page.md', 'md', 'jsxmd001'],
      ['page.mdx', 'mdx', 'jsxmdx01'],
    ] as const) {
      const rows = rowsOf(rel);
      // Only the heading outside the region is a section; the anchor inside is not indexed.
      expect(rows.map((r) => r.heading_text), rel).toEqual(['Strona']);
      expect(rows.map((r) => r.anchor), rel).not.toContain(anchor);
      // The injection did not write an anchor into the region either.
      const written = await pages.read(rel);
      expect(written.body, rel).toContain(`<Callout>\n<!-- anchor: ${anchor} -->\n## Wewnątrz JSX`);
      expect(linkedSlugs(), rel).toContain(`w-out-${ext}`);
      expect(linkedSlugs(), rel).not.toContain(`w-in-${ext}`);
    }
    // One rule for both extensions: the two pages produced the same structure.
    expect(rowsOf('page.md').length).toBe(rowsOf('page.mdx').length);
    expect(db.prepare('SELECT COUNT(*) AS n FROM section_index WHERE anchor IN (?, ?)').get('jsxmd001', 'jsxmdx01')).toEqual({ n: 0 });
  });
});
