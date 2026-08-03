/**
 * The discovery core read against the REAL indexer.
 *
 * `discovery.test.ts` mirrors the indexer's coordinate arithmetic in the test
 * itself, which is fine for stating intent but shares a weakness with the bug it
 * covers: if the mirror drifts from the indexer, the test agrees with the drift.
 * Here `SectionIndexerService` writes `section_index` and the core reads it, so
 * nothing in between is re-implemented.
 *
 * This exists because the frontmatter shift survived a green unit suite, a live
 * MCP probe against a real project, and a browser pass. The probe looked
 * convincing — a plausible 2169-character body — but that project's index turned
 * out to be entirely stale, so the read proved nothing either way. An indexer
 * that runs inside the test cannot be stale.
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { SectionIndexerService } from '../services/section-indexer.js';
import { PagesService } from '../services/pages.js';
import { PagesWatcher } from '../fs/watcher.js';
import { createDiscoveryCore } from './index.js';
import { RawEntityReader } from './raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import { DEFAULT_PAGES_ROOT_PROPS } from '../../shared/types.js';
import type { Root } from '../../shared/types.js';
import type { DiscoveryCore, GetSectionsResult, SectionResultItem } from './types.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

const host = {
  listEntities: () => [],
  listAvailable: () => [],
  getEntity: () => null,
  getAvailable: () => null,
  isActive: () => false,
  entityExists: () => false,
  getEntityService: () => null,
} as unknown as ProjectPluginHost;

const pagesRoot: Root = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true, ...DEFAULT_PAGES_ROOT_PROPS };

/** Unwraps a single-anchor `get_sections` call, asserting the item IS a section. */
function sectionItem(result: GetSectionsResult): SectionResultItem {
  const item = result.results[0];
  if (!item || !('edges' in item)) throw new Error(`expected a section item, got ${JSON.stringify(item)}`);
  return item;
}

describe('discovery core over the real section indexer', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let core: DiscoveryCore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-section-index-test-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    core = createDiscoveryCore({
      reader: new RawEntityReader(db, host),
      db,
      host,
      serialization: new SerializationEngine(host, sectionSerializer),
      roots: [pagesRoot],
      projectDir: cwd,
      packageVersion: 'test',
    });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function index(relPath: string, content: string): Promise<void> {
    await pages.write(relPath, { body: content });
    const watcher = { suppress: () => {} } as unknown as PagesWatcher;
    const indexer = new SectionIndexerService(
      db,
      new Map([['pages', { pages, watcher }]]),
      { broadcast: () => {} } as never,
      host,
    );
    // The indexer injects any missing `<!-- anchor: … -->` and rewrites the file.
    await indexer.indexPage('pages', relPath);
  }

  function anchorOf(heading: string): string {
    const row = db.prepare('SELECT anchor FROM section_index WHERE heading_text = ?').get(heading) as
      | { anchor: string }
      | undefined;
    if (!row) throw new Error(`no indexed section titled ${heading}`);
    return row.anchor;
  }

  it('returns the section that was indexed, on a page with frontmatter', async () => {
    await index(
      'fm.md',
      [
        '---',
        'title: A page with frontmatter',
        'order: 2',
        'tags: [alpha, beta]',
        '---',
        '',
        '# Top',
        '',
        '## Alpha',
        '',
        'ALPHA BODY LINE',
        '',
        '## Beta',
        '',
        'BETA BODY LINE',
        '',
      ].join('\n'),
    );

    const beta = sectionItem(await core.getSections({ anchors: [anchorOf('Beta')] }));

    expect(beta.body).toContain('BETA BODY LINE');
    // The frontmatter shift dragged the PREVIOUS section in and cut this one's tail.
    expect(beta.body).not.toContain('ALPHA BODY LINE');
    expect(beta.body).not.toContain('title: A page with frontmatter');

    const alpha = sectionItem(await core.getSections({ anchors: [anchorOf('Alpha')] }));
    expect(alpha.body).toContain('ALPHA BODY LINE');
    expect(alpha.body).not.toContain('BETA BODY LINE');
  });

  it('reports a section size that matches the body it will return', async () => {
    await index('fm2.md', ['---', 'title: X', '---', '', '# Top', '', '## Only', '', 'measured content', ''].join('\n'));

    const listed = await core.listSections({ by: 'page', rootId: 'pages', path: 'fm2.md' });
    const row = listed.items.find((s) => s.heading === 'Only');
    const fetched = sectionItem(await core.getSections({ anchors: [row!.anchor] }));

    // `size` exists so a caller can decide whether to fetch. A size that
    // describes different bytes than the fetch returns is worse than none.
    expect(row!.size).toBe(Buffer.byteLength(fetched.body!, 'utf8'));
  });

  it('attaches the right anchor to a search hit on a page with frontmatter', async () => {
    await index(
      'fm3.md',
      ['---', 'title: Y', 'order: 9', '---', '', '# Top', '', '## Hay', '', 'a needle here', ''].join('\n'),
    );

    const result = await core.searchPages({ query: 'needle' });
    if (result.mode !== 'hits') throw new Error('expected hit mode');

    expect(result.items[0]).toMatchObject({ kind: 'section', anchor: anchorOf('Hay') });
  });

  /**
   * An anchor is an identity regime. `section_index.anchor` is UNIQUE, so a
   * duplicate never raised — the upsert simply took whichever page was scanned
   * last, and the loser's section became unaddressable. Two properties have to
   * hold: the collision is REPORTED, and until it is fixed the read is
   * deterministic rather than a function of directory order.
   */
  describe('duplicate anchors', () => {
    const dup = '<!-- anchor: dupdupdu -->';

    it('two headings sharing an anchor are reported by check_consistency, with every location', async () => {
      await index(
        'dup.md',
        ['# Top', '', dup, '## First', '', 'one', '', dup, '## Second', '', 'two', ''].join('\n'),
      );

      const report = await core.checkConsistency({ rule: 'duplicate-anchor' });
      const rows = report.duplicateAnchors as Array<{
        anchor: string;
        occurrences: Array<{ rootId: string; pagePath: string; line: number; heading: string }>;
      }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.anchor).toBe('dupdupdu');
      // Both locations, or the author cannot tell which copy to re-anchor.
      expect(rows[0]!.occurrences.map((o) => o.heading)).toEqual(['First', 'Second']);
      expect(rows[0]!.occurrences.map((o) => o.pagePath)).toEqual(['dup.md', 'dup.md']);
      expect(rows[0]!.occurrences[0]!.line).toBeLessThan(rows[0]!.occurrences[1]!.line);
      // It is an error, and the summary says so before any filter.
      expect(report.summary).toMatchObject({ errors: expect.any(Number) });
      expect((report.summary as { errors: number }).errors).toBeGreaterThan(0);
    });

    /**
     * Found by running the rule against the real specification: the placeholder
     * `xxxxxxxx` appears in two pages that DOCUMENT the anchor format, and was
     * reported as a collision. The indexer only ever counts an anchor comment
     * that occupies a whole line and heads a heading; the rule has to draw the
     * same line, or it reports prose as a defect — and a rule that cries wolf
     * gets filtered out, which is worse than not having it.
     */
    it('an anchor MENTIONED in prose is not an occurrence', async () => {
      const prose = `Line that merely explains the format: ${dup} is the shape.`;
      await index('doc-a.md', ['# Top', '', prose, '', 'body', ''].join('\n'));
      await index('doc-b.md', ['# Top', '', prose, '', 'body', ''].join('\n'));

      const report = await core.checkConsistency({ rule: 'duplicate-anchor' });
      expect(report.duplicateAnchors).toEqual([]);
    });

    it('an anchor line that heads nothing is not an occurrence', async () => {
      // Trailing anchor with no heading after it — the indexer skips it too.
      await index('orphan-a.md', ['# Top', '', 'body', '', dup, ''].join('\n'));
      await index('orphan-b.md', ['# Top', '', 'body', '', dup, ''].join('\n'));

      const report = await core.checkConsistency({ rule: 'duplicate-anchor' });
      expect(report.duplicateAnchors).toEqual([]);
    });

    it('within one page the FIRST occurrence owns the anchor', async () => {
      await index(
        'dup2.md',
        ['# Top', '', dup, '## First', '', 'ONE BODY', '', dup, '## Second', '', 'TWO BODY', ''].join('\n'),
      );

      const item = sectionItem(await core.getSections({ anchors: ['dupdupdu'] }));
      expect(item.heading_text).toBe('First');
      expect(item.body).toContain('ONE BODY');
    });

    it('across pages the lowest-sorting path owns it, whichever page is indexed last', async () => {
      const page = (heading: string, body: string) =>
        ['# Top', '', dup, `## ${heading}`, '', body, ''].join('\n');

      // Index the LATER path first, so scan order and the rule disagree.
      await index('zzz.md', page('FromZ', 'Z BODY'));
      await index('aaa.md', page('FromA', 'A BODY'));
      const afterOneOrder = sectionItem(await core.getSections({ anchors: ['dupdupdu'] }));

      // Re-index the loser: it must not take the row back.
      await index('zzz.md', page('FromZ', 'Z BODY'));
      const afterReindex = sectionItem(await core.getSections({ anchors: ['dupdupdu'] }));

      expect(afterOneOrder.page_path).toBe('aaa.md');
      expect(afterReindex.page_path).toBe('aaa.md');
      expect(afterReindex.body).toContain('A BODY');
    });

    it('a freshly injected anchor never lands on one already in use', async () => {
      // Occupy a value, then let the generator mint into a table that holds it.
      await index('taken.md', ['# Top', '', dup, '## Held', '', 'held', ''].join('\n'));
      await index('fresh.md', ['# Top', '', '## Minted', '', 'minted', ''].join('\n'));

      const anchors = (
        db.prepare('SELECT anchor, page_path FROM section_index').all() as Array<{
          anchor: string;
          page_path: string;
        }>
      ).filter((r) => r.page_path === 'fresh.md');

      expect(anchors.length).toBeGreaterThan(0);
      expect(anchors.map((a) => a.anchor)).not.toContain('dupdupdu');
      // And the held section is still addressable — nothing overwrote it.
      expect(sectionItem(await core.getSections({ anchors: ['dupdupdu'] })).heading_text).toBe('Held');
    });
  });
});
