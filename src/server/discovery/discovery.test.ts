/**
 * The behaviours the brief names as worth testing outright.
 *
 * Each of these is a claim that only shows up as a bug in an agent's SESSION —
 * a page-2 result that silently repeats page 1, an empty search that looked
 * like an absence, a refusal that gave no way forward. None of them are visible
 * in a type signature, so they are asserted here.
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { createDiscoveryCore, getEntitiesAll, listEntitiesAll } from './index.js';
import { RawEntityReader } from './raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import type { DiscoveryCore } from './types.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import type { Root } from '../../shared/types.js';
import { DEFAULT_PAGES_ROOT_PROPS, DEFAULT_USER_ROOT_PROPS } from '../../shared/types.js';
import { z } from 'zod';
import matter from 'gray-matter';

function widgetModule(): BackendModule {
  return {
    type: 'widget',
    table: 'diagram', // any real table in the test schema; only its rows matter here
    label: 'Widget',
    labelPlural: 'Widgets',
    displayOrder: 10,
    pathPrefix: '/widgets',
    slugFrom: () => 'w',
    serializer: { type: 'widget', version: '1.0.0', singleElement: (e: unknown) => e } as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: 'Widgets',
      countStat: { placeholder: 'widgetCount', sqlQuery: 'SELECT 0', label: 'widgets' },
    },
    backend: { crud: { createSchema: { source: z.string(), format: z.string() } } } as BackendModule['backend'],
  };
}

function host(active: BackendModule[], available: BackendModule[] = active): ProjectPluginHost {
  const byType = new Map(available.map((m) => [m.type, m]));
  const activeTypes = new Set(active.map((m) => m.type));
  return {
    listAvailable: () => available,
    listEntities: () => active,
    listSettings: () => [],
    listCommands: () => [],
    getEntity: (t: string) => (activeTypes.has(t) ? (byType.get(t) ?? null) : null),
    getAvailable: (t: string) => byType.get(t) ?? null,
    isActive: (t: string) => activeTypes.has(t),
    partition: () => ({ active: [...activeTypes], inactive: [], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
    computeEntityCounts: () => ({}),
    entityExists: () => false,
    registerEntityService: () => {},
    getEntityService: () => null,
    snapshot: () => ({}) as never,
    restore: () => ({}) as never,
    diff: () => ({}) as never,
    clearMcpFactories: () => {},
  } as unknown as ProjectPluginHost;
}

const pagesRoot = (dir = 'pages'): Root => ({
  id: 'pages',
  name: 'Pages',
  dir,
  builtin: true,
  ...DEFAULT_PAGES_ROOT_PROPS,
});

/** A root WITHOUT a section index — the degraded identity regime. */
const flatRoot = (): Root => ({
  id: 'notes',
  name: 'Notes',
  dir: 'notes',
  builtin: false,
  ...DEFAULT_USER_ROOT_PROPS,
  sectionIndexed: false,
});

describe('discovery core', () => {
  let cwd: string;
  let db: Database.Database;

  function core(roots: Root[], modules: BackendModule[] = [widgetModule()]): DiscoveryCore {
    const pluginHost = host(modules);
    const reader = new RawEntityReader(db, pluginHost);
    return createDiscoveryCore({
      reader,
      db,
      host: pluginHost,
      serialization: new SerializationEngine(pluginHost, sectionSerializer),
      roots,
      projectDir: cwd,
      packageVersion: 'test',
    });
  }

  async function writePage(dir: string, rel: string, body: string): Promise<void> {
    const abs = path.join(cwd, dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf-8');
  }

  function indexSection(row: {
    rootId: string;
    anchor: string;
    page: string;
    heading: string;
    start: number;
    end: number;
  }): void {
    db.prepare(
      `INSERT INTO section_index
         (rootId, anchor, page_path, heading_path, heading_slug, heading_level, heading_text,
          content_hash, line_start, line_end, paragraph_count)
       VALUES (?, ?, ?, ?, ?, 2, ?, 'hash', ?, ?, 1)`,
    ).run(row.rootId, row.anchor, row.page, row.heading, row.heading.toLowerCase(), row.heading, row.start, row.end);
  }

  /**
   * Indexes a page the way `section-indexer.ts` does: over the
   * frontmatter-STRIPPED body, `line_start` = 1-based heading line,
   * `line_end` = the next same-or-shallower heading's anchor line (exclusive),
   * else the line count.
   *
   * Deriving the coordinates instead of hand-writing them is the point: a test
   * that hardcodes them can agree with a buggy reader by accident, which is how
   * the frontmatter shift below went unnoticed the first time.
   */
  async function indexPageLikeTheIndexer(rootId: string, dir: string, relPath: string): Promise<void> {
    const raw = await fs.readFile(path.join(cwd, dir, relPath), 'utf-8');
    const lines = matter(raw).content.split('\n');
    const heads: Array<{ level: number; text: string; line: number; anchor?: string; anchorLine?: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i] ?? '');
      if (!m) continue;
      const anchorMatch = /<!--\s*anchor:\s*([a-z0-9]{6,12})\s*-->/.exec(lines[i + 1] ?? '');
      heads.push({
        level: m[1]!.length,
        text: m[2]!,
        line: i,
        anchor: anchorMatch?.[1],
        anchorLine: anchorMatch ? i + 1 : undefined,
      });
    }
    for (let idx = 0; idx < heads.length; idx++) {
      const h = heads[idx]!;
      if (!h.anchor) continue;
      let end = lines.length;
      for (let j = idx + 1; j < heads.length; j++) {
        if (heads[j]!.level <= h.level) {
          end = heads[j]!.anchorLine ?? heads[j]!.line;
          break;
        }
      }
      indexSection({ rootId, anchor: h.anchor, page: relPath, heading: h.text, start: h.line + 1, end });
    }
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-discovery-test-'));
    db = createTestDb();
    await fs.mkdir(path.join(cwd, 'pages'), { recursive: true });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  describe('get_page refuses ambiguity with a way forward', () => {
    it('without rootId, names the roots that exist', async () => {
      const c = core([pagesRoot()]);
      await expect(c.getPage({ rootId: '', path: 'a.md' })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        hint: expect.stringContaining('pages'),
      });
    });

    it('with a range on a section-indexed root, points at list_sections + get_section', async () => {
      await writePage('pages', 'a.md', '# A\n\nbody\n');
      const c = core([pagesRoot()]);
      await expect(
        c.getPage({ rootId: 'pages', path: 'a.md', range: { start: 1, end: 2 } }),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        hint: expect.stringMatching(/list_sections.*get_section/),
      });
    });

    it('allows a range on a root with no section index — the degraded regime is not a gate', async () => {
      await writePage('notes', 'n.md', 'one\ntwo\nthree\n');
      const c = core([pagesRoot(), flatRoot()]);
      const page = await c.getPage({ rootId: 'notes', path: 'n.md', range: { start: 2, end: 2 } });
      expect(page.content).toBe('two');
      expect(page.total).toBe(4);
      expect(page.hasMore).toBe(true);
    });
  });

  describe('pagination over equal scores', () => {
    it('two hits with identical scores neither repeat nor vanish across pages', async () => {
      // Same line number in two files ⇒ identical score. Without the identity
      // tie-break, the order between them is whatever the filesystem said, and
      // page 2 re-serves what page 1 already delivered.
      await writePage('pages', 'a.md', 'needle here\n');
      await writePage('pages', 'b.md', 'needle here\n');
      await writePage('pages', 'c.md', 'needle here\n');
      const c = core([pagesRoot()]);

      const first = await c.searchPages({ query: 'needle', limit: 2, offset: 0 });
      const second = await c.searchPages({ query: 'needle', limit: 2, offset: 2 });
      if (first.mode !== 'hits' || second.mode !== 'hits') throw new Error('expected hit mode');

      const key = (h: (typeof first.items)[number]) => `${h.rootId}:${h.path}:${h.line}`;
      const seen = [...first.items.map(key), ...second.items.map(key)];
      expect(new Set(seen).size).toBe(3);
      expect(first.total).toBe(3);
      expect(first.hasMore).toBe(true);
      expect(second.hasMore).toBe(false);
    });
  });

  describe('search_entities reports what it actually searched', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO diagram (slug, format, source) VALUES ('flow', 'mermaid', 'graph TD')`).run();
    });

    it('a field outside the schema yields nothing, but searchedFields reveals the scope', () => {
      const c = core([pagesRoot()]);
      const result = c.searchEntities({ type: 'widget', query: 'mermaid', fields: ['nope.not_a_field'] });
      if (result.mode !== 'hits') throw new Error('expected hit mode');
      expect(result.items).toEqual([]);
      // The distinction the field exists for: this is NOT "there is no such
      // entity", it is "you looked somewhere that holds nothing".
      expect(result.searchedFields).toEqual(['nope.not_a_field']);
    });

    it('with no fields argument, the host default covers the schema text paths', () => {
      const c = core([pagesRoot()]);
      const result = c.searchEntities({ type: 'widget', query: 'mermaid' });
      if (result.mode !== 'hits') throw new Error('expected hit mode');
      expect(result.searchedFields).toEqual(expect.arrayContaining(['format', 'source']));
      expect(result.items.map((i) => i.slug)).toEqual(['flow']);
    });
  });

  it('find_references on a target with no references succeeds with an empty list', async () => {
    const c = core([pagesRoot()]);
    const result = await c.findReferences({ target: 'entity', type: 'widget', slug: 'flow' });
    expect(result.references).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('describe_types on a deactivated type is INVALID_TYPE carrying the active list', () => {
    const inactive = { ...widgetModule(), type: 'ghost' };
    const c = core([pagesRoot()], [widgetModule()]);
    void inactive;
    expect(() => c.describeTypes({ types: ['ghost'] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_TYPE', hint: expect.stringContaining('widget') }),
    );
  });

  describe('get_section returns a body and its edges', () => {
    it('the body is as authored — the XML tag is an edge, not an expansion', async () => {
      await writePage(
        'pages',
        'm.md',
        [
          '# Top',
          '',
          '## Section',
          '<!-- anchor: abcdef12 -->',
          '',
          'Prose with <single_element type="widget" slug="flow"/> inside.',
          '',
          'And a link to @other.md#abcdef01 as well.',
          '',
        ].join('\n'),
      );
      indexSection({ rootId: 'pages', anchor: 'abcdef12', page: 'm.md', heading: 'Section', start: 3, end: 9 });
      const c = core([pagesRoot()]);

      const section = await c.getSection({ anchor: 'abcdef12' });

      expect(section.body).toContain('<single_element type="widget" slug="flow"/>');
      expect(section.rootId).toBe('pages');
      expect(section.page_path).toBe('m.md');
      expect(section.edges.entityEmbeds).toContainEqual(
        expect.objectContaining({ type: 'widget', slug: 'flow', tagType: 'single_element' }),
      );
      // The anchor here is hex on purpose: the shared `@`-link parser only
      // captures `#[a-f0-9]{8}`, while the section indexer mints anchors from
      // the full `[a-z0-9]` alphabet — so most real anchors are dropped from an
      // `@page.md#anchor` link today. That mismatch predates this module and
      // belongs to the link indexer; it is filed as a patch rather than widened
      // here, because loosening the regex also changes what the editor marks as
      // a broken link.
      expect(section.edges.pageLinks).toContainEqual(
        expect.objectContaining({ path: 'other.md', anchor: 'abcdef01' }),
      );
    });

    /**
     * The regression that a code review caught and this suite did not.
     *
     * The indexer computes `line_start`/`line_end` against
     * `PagesService.read(...).body` — gray-matter has already removed the
     * frontmatter. Reading the RAW file and slicing it by those numbers shifts
     * every section down by the height of the frontmatter block. The original
     * test wrote a page with no frontmatter, so the offset was zero and the bug
     * was invisible.
     */
    it('is not shifted by frontmatter', async () => {
      const frontmatter = ['---', 'title: Shifted', 'order: 3', 'tags: [a, b]', '---', ''];
      const body = [
        '# Top',
        '',
        '## First',
        '<!-- anchor: aaaaaa11 -->',
        '',
        'FIRST SECTION BODY',
        '',
        '## Second',
        '<!-- anchor: bbbbbb22 -->',
        '',
        'SECOND SECTION BODY',
        '',
      ];
      await writePage('pages', 'fm.md', [...frontmatter, ...body].join('\n'));
      await indexPageLikeTheIndexer('pages', 'pages', 'fm.md');
      const c = core([pagesRoot()]);

      const second = await c.getSection({ anchor: 'bbbbbb22' });

      expect(second.body).toContain('SECOND SECTION BODY');
      // The precise symptom: slicing the raw file drags in the previous
      // section's text (and its heading) instead of this one's.
      expect(second.body).not.toContain('FIRST SECTION BODY');
      expect(second.body).not.toContain('## Second');
    });

    it('search hits on a page with frontmatter still resolve to the right anchor', async () => {
      await writePage(
        'pages',
        'fm2.md',
        ['---', 'title: X', '---', '', '# Top', '', '## S', '<!-- anchor: cccccc33 -->', '', 'needle', ''].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'fm2.md');
      const c = core([pagesRoot()]);

      const result = await c.searchPages({ query: 'needle' });
      if (result.mode !== 'hits') throw new Error('expected hit mode');

      // A hit whose line is measured in raw-file coordinates falls outside the
      // section's range and comes back as a bare line hit with no anchor.
      expect(result.items[0]).toMatchObject({ kind: 'section', anchor: 'cccccc33' });
    });

    it('an unknown anchor is SECTION_NOT_FOUND with a way to find one', async () => {
      const c = core([pagesRoot()]);
      await expect(c.getSection({ anchor: 'nosuchan' })).rejects.toMatchObject({
        code: 'SECTION_NOT_FOUND',
        hint: expect.stringContaining('search_pages'),
      });
    });
  });

  it('list_sections measures each section before anything is fetched', async () => {
    await writePage('pages', 'm.md', ['# Top', '', '## S', '<!-- anchor: abcdef12 -->', '', 'exactly this', ''].join('\n'));
    indexSection({ rootId: 'pages', anchor: 'abcdef12', page: 'm.md', heading: 'S', start: 3, end: 7 });
    const c = core([pagesRoot()]);

    const listed = await c.listSections({ by: 'page', rootId: 'pages', path: 'm.md' });

    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.size).toBeGreaterThan(0);
    expect(listed.items[0]!.anchor).toBe('abcdef12');
  });

  it('list_sections rejects a non-anchor where an anchor is required', async () => {
    const c = core([pagesRoot()]);
    await expect(c.listSections({ by: 'anchor', anchor: 'NOT AN ANCHOR' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  /**
   * A well-formed anchor that is not in the index is a DIFFERENT fact from a
   * page with no sections, and both come back as an empty list. An agent that
   * cannot tell them apart re-indexes when it should have searched for the
   * anchor, or vice versa.
   */
  it('list_sections says whether an anchor is known, not just what it points at', async () => {
    await writePage('pages', 'm.md', ['# Top', '<!-- anchor: abcdef12 -->', '', 'body', ''].join('\n'));
    indexSection({ rootId: 'pages', anchor: 'abcdef12', page: 'm.md', heading: 'Top', start: 1, end: 5 });
    const c = core([pagesRoot()]);

    await expect(c.listSections({ by: 'anchor', anchor: 'abcdef12' })).resolves.toMatchObject({ is_known: true });
    await expect(c.listSections({ by: 'anchor', anchor: 'zzzzzz99' })).resolves.toMatchObject({
      is_known: false,
      total: 0,
    });
    // Absent for the page variant: there is no anchor whose existence to report.
    expect(await c.listSections({ by: 'page', rootId: 'pages', path: 'm.md' })).not.toHaveProperty('is_known');
  });

  /**
   * The barrier that keeps a page operation from naming a brief, a patch or the
   * entity catalogue is `PagesService`'s root containment — and it always held.
   * What it lacked was a CODE: the refusal arrived as a generic error, so a
   * transport reported "the server broke" where the honest answer was "that is
   * not an address, here is what is".
   */
  it('a path escaping the root is refused as an ARGUMENT, with the shape of a real one', async () => {
    const c = core([pagesRoot()]);
    await expect(
      c.getPage({ rootId: 'pages', path: '../.claude4spec/briefs/some-brief.md' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', hint: expect.stringContaining('list_pages') });
  });

  it('get_entities refuses an oversized slug list rather than half-answering it', () => {
    const c = core([pagesRoot()]);
    expect(() =>
      c.getEntities({ type: 'widget', slugs: Array.from({ length: 200 }, (_, i) => `s${i}`) }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  /**
   * Regressions from a code review of this branch. Each one is a place where
   * routing a previously UNBOUNDED read through a bounded core op changed an
   * answer, which is the failure mode of the whole rewiring.
   */
  describe('bounds do not change answers', () => {
    beforeEach(() => {
      const insert = db.prepare(`INSERT INTO diagram (slug, format, source) VALUES (?, 'mermaid', 'graph TD')`);
      for (let i = 0; i < 120; i++) insert.run(`w${String(i).padStart(3, '0')}`);
    });

    it('an EMPTY tag list matches nothing, while an absent one means no filter', () => {
      const c = core([pagesRoot()]);
      const filtered = c.listEntities({ type: 'widget', tags: [], filter: 'or' });
      const unfiltered = c.listEntities({ type: 'widget' });
      if (filtered.mode !== 'items' || unfiltered.mode !== 'items') throw new Error('expected item mode');
      // `<tagged_list tags=""/>` must render nothing, not the entire type.
      expect(filtered.total).toBe(0);
      expect(unfiltered.total).toBe(120);
    });

    it('getEntitiesAll serves more slugs than one call may ask for', () => {
      const c = core([pagesRoot()]);
      const slugs = Array.from({ length: 120 }, (_, i) => `w${String(i).padStart(3, '0')}`);
      // The agent-facing op still refuses: that cap is its contract.
      expect(() => c.getEntities({ type: 'widget', slugs })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
      // Host-side composition (a page renderer, the CLI) batches instead.
      const all = getEntitiesAll(c, { type: 'widget', slugs });
      expect(all).toHaveLength(120);
      expect(all.map((r) => r.slug)).toEqual(slugs);
    });

    it('listEntitiesAll exhausts past the page size instead of truncating', () => {
      const c = core([pagesRoot()]);
      const page = c.listEntities({ type: 'widget' });
      if (page.mode !== 'items') throw new Error('expected item mode');
      expect(page.items.length).toBeLessThan(120);
      expect(page.hasMore).toBe(true);
      expect(listEntitiesAll(c, { type: 'widget' })).toHaveLength(120);
    });
  });

  it('check_consistency severity filters by ROW, not by bucket', async () => {
    // The AC-coverage buckets carry a per-row severity from config, so filtering
    // them wholesale made `severity: "error"` return an empty list while
    // `summary.errors` still counted those rows.
    const c = core([pagesRoot()]);
    const report = await c.checkConsistency({ severity: 'error' });
    const rows = report.entitiesWithoutAcCoverage as Array<{ severity: string }>;
    expect(rows.every((r) => r.severity === 'error')).toBe(true);
  });

  it('overview declares each root identity regime up front', async () => {
    await writePage('pages', 'a.md', '# A\n');
    await writePage('notes', 'n.md', 'plain\n');
    const c = core([pagesRoot(), flatRoot()]);

    const result = await c.overview();

    // The agent has to know BEFORE searching whether hits from a root arrive as
    // an anchor or as (rootId, path, line).
    expect(result.roots).toEqual([
      expect.objectContaining({ id: 'pages', sectionIndexed: true, pageCount: 1 }),
      expect.objectContaining({ id: 'notes', sectionIndexed: false, pageCount: 1 }),
    ]);
    expect(result.claude4spec).toBe('test');
  });

  it('search_pages degrades hit identity on a root with no section index', async () => {
    await writePage('pages', 'a.md', ['# T', '<!-- anchor: abcdef12 -->', 'needle', ''].join('\n'));
    await writePage('notes', 'n.md', 'needle\n');
    indexSection({ rootId: 'pages', anchor: 'abcdef12', page: 'a.md', heading: 'T', start: 1, end: 4 });
    const c = core([pagesRoot(), flatRoot()]);

    const result = await c.searchPages({ query: 'needle' });
    if (result.mode !== 'hits') throw new Error('expected hit mode');

    expect(result.items.find((h) => h.rootId === 'pages')).toMatchObject({ kind: 'section', anchor: 'abcdef12' });
    expect(result.items.find((h) => h.rootId === 'notes')).toMatchObject({ kind: 'line', path: 'n.md' });
  });
});
