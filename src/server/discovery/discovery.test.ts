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
import { applyPagesOverride } from './pages-override.js';
import { applyProjection } from '../db/projection.js';
import type { DataDeclaration } from '../../shared/plugin-host/data-schema.js';
import {
  createDiscoveryCore,
  findReferencesAll,
  getEntitiesAll,
  listEntitiesAll,
  MAX_ANCHORS_PER_CALL,
} from './index.js';
import { DEFAULT_BUDGET_CHARS } from './budget.js';
import { RawEntityReader } from './raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import type { DiscoveryCore, SectionResultItem } from './types.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import type { Root } from '../../shared/types.js';
import { DEFAULT_PAGES_ROOT_PROPS, DEFAULT_USER_ROOT_PROPS } from '../../shared/types.js';
import { z } from 'zod';
import matter from 'gray-matter';

/**
 * 2.0.0: the fixture declares its OWN schema and gets its own generated table.
 *
 * It used to carry `table: 'diagram'` and borrow that type's rows — a trick the
 * declarative contract makes both unnecessary and impossible, since a table name
 * is derived from the type slug and can no longer be pointed elsewhere. Owning
 * its schema is also the stronger fixture: it proves the discovery core works
 * for a type the host has never heard of, rather than for `diagram` under
 * another name.
 */
const WIDGET_DATA: DataDeclaration = {
  schema: {
    format: { kind: 'enum', values: ['mermaid', 'd2'], required: true, default: 'mermaid' },
    source: { kind: 'string', required: true, default: '' },
  },
};

function widgetModule(): BackendModule {
  return {
    type: 'widget',
    data: WIDGET_DATA,
    slugPattern: [{ op: 'slugify', field: 'source' }],
    payloadVersion: 1,
    label: 'Widget',
    labelPlural: 'Widgets',
    displayOrder: 10,
    pathPrefix: '/widgets',
    serializer: { payloadVersion: 1, views: { single_element: (e: unknown) => e } } as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: 'Widgets',
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

  /**
   * `level` used to be hardcoded to 2 here, which made the index disagree with
   * the document for any page that nests: a `###` heading was recorded as a
   * sibling of the `##` above it. Nothing noticed until `get_sections` started
   * deriving subtree COVERAGE from `heading_level` — the real indexer has always
   * written the true level, so the helper was the only liar.
   */
  function indexSection(row: {
    rootId: string;
    anchor: string;
    page: string;
    heading: string;
    start: number;
    end: number;
    level?: number;
  }): void {
    db.prepare(
      `INSERT INTO section_index
         (rootId, anchor, page_path, heading_path, heading_slug, heading_level, heading_text,
          content_hash, line_start, line_end, paragraph_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'hash', ?, ?, 1)`,
    ).run(
      row.rootId,
      row.anchor,
      row.page,
      row.heading,
      row.heading.toLowerCase(),
      row.level ?? 2,
      row.heading,
      row.start,
      row.end,
    );
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
      indexSection({
        rootId,
        anchor: h.anchor,
        page: relPath,
        heading: h.text,
        start: h.line + 1,
        end,
        level: h.level,
      });
    }
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-discovery-test-'));
    db = createTestDb();
    applyProjection(db, [widgetModule()]);
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

    it('with a range on a section-indexed root, points at list_sections + get_sections', async () => {
      await writePage('pages', 'a.md', '# A\n\nbody\n');
      const c = core([pagesRoot()]);
      await expect(
        c.getPage({ rootId: 'pages', path: 'a.md', range: { start: 1, end: 2 } }),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        hint: expect.stringMatching(/list_sections.*get_sections/),
      });
    });

    it('allows a range on a root with no section index — the degraded regime is not a gate', async () => {
      await writePage('notes', 'n.md', 'one\ntwo\nthree\n');
      const c = core([pagesRoot(), flatRoot()]);
      const page = await c.getPage({ rootId: 'notes', path: 'n.md', range: { start: 2, end: 2 } });
      expect(page.content).toBe('two');
      // No `total`, no `hasMore`: the budget that truncates counts CHARACTERS,
      // so a line counter beside it measures in the wrong unit. `truncated` is
      // the whole cut signal.
      expect(page).not.toHaveProperty('total');
      expect(page).not.toHaveProperty('hasMore');
    });

    /**
     * The loop this closes: a page on an indexed root came back truncated with
     * an instruction to re-read it via `range` — the argument the very same
     * operation refuses. Following the hint produced INVALID_ARGUMENT, which
     * sent the agent back to get_page, which produced the same hint.
     */
    it('the truncation hint on an indexed root never proposes the range that get_page refuses', async () => {
      await writePage('pages', 'big.md', `# H\n\n${'x'.repeat(DEFAULT_BUDGET_CHARS + 1000)}\n`);
      const c = core([pagesRoot()]);
      const page = await c.getPage({ rootId: 'pages', path: 'big.md' });
      expect(page.truncated).toBe(true);
      expect(page.truncationHint).toMatch(/list_sections.*get_sections/);
      expect(page.truncationHint).not.toMatch(/range/);
    });

    it('the truncation hint on a root without a section index still proposes range', async () => {
      await writePage('notes', 'big.md', 'x'.repeat(DEFAULT_BUDGET_CHARS + 1000));
      const c = core([pagesRoot(), flatRoot()]);
      const page = await c.getPage({ rootId: 'notes', path: 'big.md' });
      expect(page.truncated).toBe(true);
      expect(page.truncationHint).toMatch(/range/);
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
      db.prepare(`INSERT INTO widget (slug, format, source) VALUES ('flow', 'mermaid', 'graph TD')`).run();
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

  it('describe_types rejects an unknown view in the CORE, before any type is touched', () => {
    // 0.2.9 (item 9/14): the guard used to live in the MCP zod enum and in the
    // CLI's own list — two transport-local copies and no rule for anyone else,
    // so a bad view reached the serializer and came back as a shrug.
    const c = core([pagesRoot()], [widgetModule()]);
    expect(() => c.describeTypes({ view: 'summary' as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_VIEW', hint: expect.stringContaining('single_element') }),
    );
  });

  it('describe_types answers every view, computed or generic', () => {
    // "Generic is the rule": a type that computes ONE view still answers all
    // five, and must not read as supporting only the one — which is what the old
    // presence-check chain reported. The fixture computes `single_element` only.
    const c = core([pagesRoot()], [widgetModule()]);
    const described = c.describeTypes({ types: ['widget'] }).types[0]!;
    expect(described.views).toEqual([
      'inline_mention',
      'single_element',
      'element_list_item',
      'tagged_list_item',
      'detail',
    ]);
    expect(described.payloadVersion).toBe(1);
    // Derived from `data.schema` — no `_auto`, no db reflection, and closed,
    // because the host builds this payload itself.
    const generic = described.schemas.inline_mention as Record<string, unknown>;
    expect(generic._auto).toBeUndefined();
    expect(generic.additionalProperties).toBe(false);
    expect((generic.properties as Record<string, unknown>)._view).toEqual({ const: 'inline_mention' });
    // The computed one is a FLOOR, not a contract — the host cannot introspect
    // the function that builds it, so the schema stays open and says so.
    const computed = described.schemas.single_element as Record<string, unknown>;
    expect(computed.additionalProperties).toBe(true);
    expect(computed['x-computed']).toBe(true);
  });

  describe('get_sections returns bodies and their edges', () => {
    /**
     * 0.2.5 — the operation batches, so every assertion below reaches through
     * `results[]`. `one()` keeps the single-anchor cases readable without
     * hiding the envelope: it asserts the item IS a section (rather than an
     * error or a `coveredBy` pointer), which is exactly what a bare
     * `results[0]` would let slip past.
     */
    const one = (result: Awaited<ReturnType<DiscoveryCore['getSections']>>): SectionResultItem => {
      expect(result.results).toHaveLength(1);
      const item = result.results[0]!;
      if (!('edges' in item)) throw new Error(`expected a section item, got ${JSON.stringify(item)}`);
      return item;
    };

    /**
     * 0.2.6 — the second breaking change of the `get_section` → `get_sections`
     * migration, and the one a consumer would have learned about at runtime.
     *
     * A hash exists to settle "is what I hold still current". This response
     * hands over the CONTENT, so there is nothing left for a version of it to
     * settle — and a field kept "just in case" becomes a cache key somebody
     * builds a stale-detection scheme on. It stays where it does work: the
     * `section_index` column and the REST section endpoints.
     */
    it('carries no content_hash — the response is the content, not a version of it', async () => {
      await writePage('pages', 'h.md', ['# Top', '', '## S', '<!-- anchor: abcdef12 -->', '', 'body', ''].join('\n'));
      indexSection({ rootId: 'pages', anchor: 'abcdef12', page: 'h.md', heading: 'S', start: 3, end: 7 });
      const c = core([pagesRoot()]);

      const section = one(await c.getSections({ anchors: ['abcdef12'] }));

      expect(section).not.toHaveProperty('content_hash');
      expect(section).not.toHaveProperty('contentHash');
      // Not merely absent from the wire projection — absent from the `detail`
      // view that feeds it, which is where a re-projection would find it again.
      const detail = new SerializationEngine(host([widgetModule()]), sectionSerializer).serializeSection(
        'detail',
        {
          rootId: 'pages',
          anchor: 'abcdef12',
          pagePath: 'h.md',
          headingPath: 'S',
          headingSlug: 's',
          headingText: 'S',
          headingLevel: 2,
          contentHash: 'hash',
          lineStart: 3,
          lineEnd: 7,
        },
        new RawEntityReader(db, host([widgetModule()])),
      ).data as Record<string, unknown>;
      expect(detail).not.toHaveProperty('contentHash');
    });

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

      const section = one(await c.getSections({ anchors: ['abcdef12'] }));

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

      const second = one(await c.getSections({ anchors: ['bbbbbb22'] }));

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

    /**
     * 0.2.5 — the failure is per-ITEM, which is the property that makes a batch
     * worth calling. Before, one bad anchor threw and the caller lost every
     * good section it had asked for in the same call, so the safe move was to
     * go back to one call per anchor — exactly the N+1 this operation removes.
     */
    it('an unknown anchor fails its own item while the rest still come back with bodies', async () => {
      await writePage(
        'pages',
        'mix.md',
        ['# Top', '', '## Real', '<!-- anchor: aaaaaa11 -->', '', 'REAL BODY', ''].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'mix.md');
      const c = core([pagesRoot()]);

      const result = await c.getSections({ anchors: ['nosuchan', 'aaaaaa11'] });

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({ anchor: 'nosuchan', code: 'SECTION_NOT_FOUND' });
      expect(result.results[1]).toMatchObject({ anchor: 'aaaaaa11' });
      expect((result.results[1] as SectionResultItem).body).toContain('REAL BODY');
    });

    it('returns items in input order, after silently de-duplicating', async () => {
      await writePage(
        'pages',
        'ord.md',
        [
          '# Top',
          '',
          '## First',
          '<!-- anchor: aaaaaa11 -->',
          '',
          'ONE',
          '',
          '## Second',
          '<!-- anchor: bbbbbb22 -->',
          '',
          'TWO',
          '',
        ].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'ord.md');
      const c = core([pagesRoot()]);

      // Asked out of page order, with a repeat: the answer follows the CALLER's
      // order, not the page's, and the duplicate collapses onto its first slot.
      const result = await c.getSections({ anchors: ['bbbbbb22', 'aaaaaa11', 'bbbbbb22'] });

      expect(result.results.map((i) => i.anchor)).toEqual(['bbbbbb22', 'aaaaaa11']);
    });

    it('refuses an empty or over-long anchors[] with the limit it enforces', async () => {
      const c = core([pagesRoot()]);

      // The limit is the ONLY valve on the request side — this operation does
      // not paginate — so the refusal has to state it rather than just say no.
      await expect(c.getSections({ anchors: [] })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining(String(MAX_ANCHORS_PER_CALL)),
      });
      await expect(
        c.getSections({ anchors: Array.from({ length: MAX_ANCHORS_PER_CALL + 1 }, (_, i) => `a${i}`) }),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining(String(MAX_ANCHORS_PER_CALL)),
      });
    });

    /**
     * The budget cut has to be a FUNCTION of the input order, or a caller
     * cannot act on it: the documented remedy is "retry with a smaller subset",
     * which is only sound if the same call cuts in the same place every time.
     */
    it('cuts deterministically — same input order, same meta-only items', async () => {
      const big = 'x'.repeat(60_000);
      await writePage(
        'pages',
        'big.md',
        [
          '# Top',
          '',
          '## One',
          '<!-- anchor: aaaaaa11 -->',
          '',
          big,
          '',
          '## Two',
          '<!-- anchor: bbbbbb22 -->',
          '',
          big,
          '',
          '## Three',
          '<!-- anchor: cccccc33 -->',
          '',
          big,
          '',
        ].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'big.md');
      const c = core([pagesRoot()]);

      const anchors = ['aaaaaa11', 'bbbbbb22', 'cccccc33'];
      const first = await c.getSections({ anchors });
      const second = await c.getSections({ anchors });

      expect(first.truncated).toBe(true);
      expect(first.message).toBeTruthy();
      const cut = (r: typeof first): string[] =>
        r.results.filter((i) => 'edges' in i && i.body === undefined).map((i) => i.anchor);
      expect(cut(first)).toEqual(cut(second));
      expect(cut(first).length).toBeGreaterThan(0);

      // Degraded, not dropped: a caller can still see WHAT it did not get.
      // Dropping would be indistinguishable from "that anchor does not exist".
      expect(first.results).toHaveLength(3);
      for (const item of first.results.filter((i) => 'edges' in i && i.body === undefined)) {
        expect(item).toMatchObject({ truncated: true, line_start: expect.any(Number) });
        expect((item as SectionResultItem).edges).toBeDefined();
      }
      // The first item keeps a body even though it alone exceeds the budget —
      // otherwise a one-anchor call has no answer AND no smaller subset to ask.
      expect((first.results[0] as SectionResultItem).body).toBeTruthy();
    });

    it('a section covered by another requested subtree points at it instead of repeating the body', async () => {
      await writePage(
        'pages',
        'tree.md',
        [
          '# Top',
          '',
          '## Parent',
          '<!-- anchor: aaaaaa11 -->',
          '',
          'PARENT BODY',
          '',
          '### Child',
          '<!-- anchor: bbbbbb22 -->',
          '',
          'CHILD BODY',
          '',
          '## Sibling',
          '<!-- anchor: cccccc33 -->',
          '',
          'SIBLING BODY',
          '',
        ].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'tree.md');
      const c = core([pagesRoot()]);

      const result = await c.getSections({ anchors: ['aaaaaa11', 'bbbbbb22', 'cccccc33'], includeSubtree: true });

      const parent = result.results[0] as SectionResultItem;
      expect(parent.body).toContain('CHILD BODY');
      // No duplicate body: the child's text is already inside the parent's item.
      expect(result.results[1]).toEqual({ anchor: 'bbbbbb22', coveredBy: 'aaaaaa11' });
      // A SIBLING is not covered — the subtree ends at the next same-or-shallower
      // heading, so `cccccc33` still gets its own body.
      expect((result.results[2] as SectionResultItem).body).toContain('SIBLING BODY');
    });

    it('a covered item inherits truncation from the item that holds its body', async () => {
      const big = 'y'.repeat(130_000);
      await writePage(
        'pages',
        'cut.md',
        [
          '# Top',
          '',
          '## Lead',
          '<!-- anchor: dddddd44 -->',
          '',
          'y'.repeat(119_000),
          '',
          '## Parent',
          '<!-- anchor: aaaaaa11 -->',
          '',
          big,
          '',
          '### Child',
          '<!-- anchor: bbbbbb22 -->',
          '',
          'CHILD BODY',
          '',
        ].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'cut.md');
      const c = core([pagesRoot()]);

      const result = await c.getSections({
        anchors: ['dddddd44', 'aaaaaa11', 'bbbbbb22'],
        includeSubtree: true,
      });

      const parent = result.results[1] as SectionResultItem;
      expect(parent.truncated).toBe(true);
      expect(parent.body).toBeUndefined();
      /**
       * The flag has to travel. `coveredBy` promises the body lives upstream;
       * when the upstream item was cut, an un-flagged pointer would send the
       * caller to fetch something that is not there — worse than saying nothing,
       * because it looks like a successful answer.
       */
      expect(result.results[2]).toEqual({ anchor: 'bbbbbb22', coveredBy: 'aaaaaa11', truncated: true });
    });

    /**
     * Three levels deep, requested INNERMOST FIRST. The middle section claims
     * the deepest one before the outermost claims the middle, so a
     * first-writer-wins map left `cccccc33 -> bbbbbb22` — a pointer at an item
     * that has no body of its own. `coveredBy` without `truncated` is a promise
     * that the body is present upstream, so it has to name the item that
     * actually holds it, not the nearest ancestor that happens to be requested.
     */
    it('a coveredBy pointer always names an item that has a body, never a covered one', async () => {
      await writePage(
        'pages',
        'chain.md',
        [
          '# Top',
          '',
          '## Parent',
          '<!-- anchor: aaaaaa11 -->',
          '',
          'PARENT BODY',
          '',
          '### Child',
          '<!-- anchor: bbbbbb22 -->',
          '',
          'CHILD BODY',
          '',
          '#### Grand',
          '<!-- anchor: cccccc33 -->',
          '',
          'GRAND BODY',
          '',
        ].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'chain.md');
      const c = core([pagesRoot()]);

      const result = await c.getSections({
        anchors: ['bbbbbb22', 'aaaaaa11', 'cccccc33'],
        includeSubtree: true,
      });

      const holder = result.results[1] as SectionResultItem;
      expect(holder.anchor).toBe('aaaaaa11');
      expect(holder.body).toContain('GRAND BODY');
      expect(result.results[0]).toEqual({ anchor: 'bbbbbb22', coveredBy: 'aaaaaa11' });
      expect(result.results[2]).toEqual({ anchor: 'cccccc33', coveredBy: 'aaaaaa11' });

      // The property, stated once so it survives a rewrite of the fixture: every
      // pointer resolves in ONE hop to an item carrying a body.
      for (const item of result.results) {
        if (!('coveredBy' in item)) continue;
        const target = result.results.find((i) => i.anchor === item.coveredBy);
        expect((target as SectionResultItem).body).toBeTruthy();
      }
    });

    /**
     * A root that lost its section index takes its whole page down together, so
     * the child cannot be answered with "your body is upstream" — upstream is an
     * error item. Coverage is therefore resolved only among anchors that can
     * actually produce a body.
     */
    it('a de-indexed root produces per-item errors, never a coveredBy at an error', async () => {
      await writePage(
        'pages',
        'gone.md',
        ['# Top', '', '## Parent', '<!-- anchor: aaaaaa11 -->', '', 'P', '', '### Child', '<!-- anchor: bbbbbb22 -->', '', 'C', ''].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'gone.md');
      // Same rows, but the root no longer declares a section index.
      const c = core([flatRoot()]);

      const result = await c.getSections({
        anchors: ['aaaaaa11', 'bbbbbb22'],
        includeSubtree: true,
      });

      expect(result.results.every((i) => 'error' in i)).toBe(true);
      expect(result.results.some((i) => 'coveredBy' in i)).toBe(false);
    });

    /**
     * One anchor whose body alone overruns the budget. The item is text-
     * truncated rather than emptied, and the instruction for what to do about it
     * has to reach the caller: the item shape lost `truncationHint` in 0.2.5, so
     * the envelope is the only place left for it. A silent `truncated: true`
     * with no top-level flag reads as "nothing was cut" to anything branching on
     * the envelope.
     */
    it('a text-truncated body still reports the cut and its remedy on the envelope', async () => {
      await writePage(
        'pages',
        'huge.md',
        ['# Top', '', '## Big', '<!-- anchor: eeeeee55 -->', '', 'z'.repeat(130_000), ''].join('\n'),
      );
      await indexPageLikeTheIndexer('pages', 'pages', 'huge.md');
      const c = core([pagesRoot()]);

      const result = await c.getSections({ anchors: ['eeeeee55'] });

      const item = result.results[0] as SectionResultItem;
      expect(item.truncated).toBe(true);
      expect(item.body).toBeTruthy(); // never a dead end — a usable prefix survives
      expect(result.truncated).toBe(true);
      // The remedy has to be one the caller can actually run. It used to offer
      // "the page window with get_page" first — but a section only ever lives on
      // a section-indexed root, and that is exactly where get_page refuses a
      // `range`, so the page-window half was dead on every input that can reach
      // this line. Narrowing to a child section is what remains true.
      expect(result.message).toContain('list_sections');
      expect(result.message).toContain('get_sections');
      expect(result.message).not.toContain('get_page');
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
   * `is_known` answers about the ANCHOR, not about which roots are currently
   * listable. An anchor indexed on a root that has since lost `sectionIndexed`
   * is still a real anchor — saying "no such anchor" about one `get_section`
   * resolves gives the caller two contradictory facts about the same string,
   * and the plausible next move is to delete or re-author a live section.
   */
  it('an anchor on a de-indexed root is still known, even though it does not list', async () => {
    await writePage('notes', 'n.md', ['# Note', '', 'body', ''].join('\n'));
    indexSection({ rootId: 'notes', anchor: 'abcdef12', page: 'n.md', heading: 'Note', start: 1, end: 4 });
    const c = core([pagesRoot(), flatRoot()]); // `notes` has sectionIndexed: false

    const listed = await c.listSections({ by: 'anchor', anchor: 'abcdef12' });

    expect(listed.items).toEqual([]); // not listable — the root has no section index
    expect(listed.is_known).toBe(true); // but the anchor exists
  });

  /**
   * Every sibling operation refuses a half-named page; this one used to answer.
   * `page_path = NULL` matches no row, so the caller got "that page has no
   * sections" for a call that never named a page.
   */
  it('list_sections by page refuses a missing path instead of answering empty', async () => {
    const c = core([pagesRoot()]);
    await expect(
      c.listSections({ by: 'page', rootId: 'pages' } as Parameters<typeof c.listSections>[0]),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', hint: expect.stringContaining('list_pages') });
  });

  /**
   * An unknown type matches no XML tag, so the sweep returns `[]` — and `[]`
   * from this operation is the answer that authorizes a rename or a delete.
   * A mis-spelled type is exactly the case the caller most needs told about.
   */
  it('find_references on an unknown entity type refuses instead of reporting no consumers', async () => {
    const c = core([pagesRoot()]);
    await expect(c.findReferences({ target: 'entity', type: 'widgets', slug: 'w' })).rejects.toMatchObject({
      code: 'INVALID_TYPE',
      hint: expect.stringContaining('widget'),
    });
  });

  /**
   * One slug is a lookup and wants the whole record; many slugs are a list and
   * want a row each. A flat `single_element` default made a view-less batch as
   * wide as N detail records — enough to hit the budget and come back truncated
   * where the same call used to return everything.
   */
  it('get_entities defaults narrow for a batch and wide for a single slug', () => {
    db.prepare(`INSERT INTO widget (slug, format, source) VALUES ('a', 'mermaid', 'graph TD;')`).run();
    db.prepare(`INSERT INTO widget (slug, format, source) VALUES ('b', 'mermaid', 'graph TD;')`).run();
    const c = core([pagesRoot()]);

    expect(c.getEntities({ type: 'widget', slugs: ['a'] }).view).toBe('single_element');
    expect(c.getEntities({ type: 'widget', slugs: ['a', 'b'] }).view).toBe('element_list_item');
    // An explicit view still wins over both.
    expect(c.getEntities({ type: 'widget', slugs: ['a', 'b'], view: 'detail' }).view).toBe('detail');
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
   * 0.2.6 — the two halves of "fetch by key" now share ONE budget branch.
   *
   * `get_entities` used to DROP the tail it could not afford. The caller named
   * those slugs, so a missing one reads as "that entity does not exist" — the
   * confusion the whole error catalogue exists to prevent, and one that
   * authorizes a rename or a delete on a false premise.
   */
  describe('get_entities answers every key it was given', () => {
    beforeEach(() => {
      // Each row is deliberately huge: three of them cannot share one budget.
      const insert = db.prepare(`INSERT INTO widget (slug, format, source) VALUES (?, 'mermaid', ?)`);
      for (const slug of ['w1', 'w2', 'w3']) insert.run(slug, 'g'.repeat(60_000));
    });

    it('degrades past the budget instead of dropping, and never degrades the first item', () => {
      const c = core([pagesRoot()]);
      const result = c.getEntities({ type: 'widget', slugs: ['w1', 'w2', 'w3'], view: 'detail' });

      // Nothing the caller named goes missing.
      expect(result.results.map((r) => r.slug)).toEqual(['w1', 'w2', 'w3']);
      expect(result.truncated).toBe(true);
      // The instruction lives on the envelope — the item only says THAT it was cut.
      expect(result.message).toBeTruthy();
      expect(result).not.toHaveProperty('truncationHint');

      // A one-slug call is already the smallest possible retry, so the first
      // item is emitted whole: degrading it would leave the caller with no
      // answer AND no smaller subset to ask for.
      expect(result.results[0]!.entity).not.toBeNull();
      expect(result.results[0]).not.toHaveProperty('truncated');

      const cut = result.results.filter((r) => r.truncated === true);
      expect(cut.length).toBeGreaterThan(0);
      for (const item of cut) expect(item.entity).toBeNull();
    });

    /**
     * `entity: null` alone already means "no such entity". A budget cut must
     * therefore carry its own marker, or the two answers — "does not exist" and
     * "did not fit" — become the same answer, and only one of them is worth a
     * retry.
     */
    it('a missing slug is null WITHOUT truncated, so absence stays distinct from a cut', () => {
      const c = core([pagesRoot()]);
      const result = c.getEntities({ type: 'widget', slugs: ['w1', 'nope'], view: 'single_element' });

      const missing = result.results.find((r) => r.slug === 'nope')!;
      expect(missing.entity).toBeNull();
      expect(missing).not.toHaveProperty('truncated');
    });

    it('de-duplicates slugs, first occurrence keeping its position', () => {
      const c = core([pagesRoot()]);
      const result = c.getEntities({ type: 'widget', slugs: ['w2', 'w1', 'w2'], view: 'inline_mention' });
      expect(result.results.map((r) => r.slug)).toEqual(['w2', 'w1']);
    });

    /**
     * The default view widens with the size of the request, so it has to be
     * measured against the request that is actually served. Measuring the raw
     * list made `["order","order"]` — which answers with exactly one entity —
     * come back in the narrow list projection, while the identical de-duplicated
     * call came back whole.
     */
    it('picks the default view AFTER de-duplication, so a repeated slug is still a lookup', () => {
      const c = core([pagesRoot()]);
      expect(c.getEntities({ type: 'widget', slugs: ['w1', 'w1'] }).view).toBe('single_element');
      expect(c.getEntities({ type: 'widget', slugs: ['w1'] }).view).toBe('single_element');
      expect(c.getEntities({ type: 'widget', slugs: ['w1', 'w2'] }).view).toBe('element_list_item');
    });

    /**
     * The host-side composition must not hand a renderer a degraded row: the
     * renderer reads `entity: null` as "no such entity" and prints it as missing.
     * A single-slug retry cannot degrade (the first item is never demoted), which
     * is what makes this terminate.
     */
    it('getEntitiesAll re-asks for truncated rows, so no caller sees a budget cut as absence', () => {
      const c = core([pagesRoot()]);
      const all = getEntitiesAll(c, { type: 'widget', slugs: ['w1', 'w2', 'w3'], view: 'detail' });
      expect(all.map((r) => r.slug)).toEqual(['w1', 'w2', 'w3']);
      expect(all.filter((r) => r.truncated === true)).toEqual([]);
      for (const row of all) expect(row.entity).not.toBeNull();
    });
  });

  /**
   * The sweep must not stop at a page boundary.
   *
   * No project in this repo's own spec has more than a dozen references to one
   * entity, so a live walk cannot exercise this — which is exactly how a silent
   * cap at the core's default page size (100) would ship unnoticed and tell a
   * caller that 150 real call sites do not exist. A fake core with a known
   * population is the only honest way to assert it.
   */
  it('findReferencesAll pages past the default limit instead of taking the first page', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({
      rootId: 'pages',
      pagePath: `p${i}.md`,
      tagType: 'single_element',
      line: i,
    }));
    let calls = 0;
    const fake = {
      findReferences: (input: { limit?: number; offset?: number }) => {
        calls++;
        const offset = input.offset ?? 0;
        const items = all.slice(offset, offset + (input.limit ?? 100));
        return Promise.resolve({ references: items, total: all.length, hasMore: offset + items.length < all.length });
      },
    } as unknown as DiscoveryCore;

    const hits = await findReferencesAll(fake, { target: 'entity', type: 'widget', slug: 'w' });

    expect(hits).toHaveLength(2500);
    expect(hits.map((h) => h.pagePath)).toEqual(all.map((h) => h.pagePath));
    expect(calls).toBeGreaterThan(1);
  });

  /**
   * 0.2.6 — a typo in `rootId` and a page that is not there are different
   * situations with different remedies, so they stop sharing a code.
   * `PAGE_NOT_FOUND` is the answer that authorizes a caller to stop looking;
   * saying it about an unknown root sent callers hunting for a file inside a
   * directory that never existed.
   */
  it('an unknown rootId is an ARGUMENT error naming the roots, not a missing page', async () => {
    const c = core([pagesRoot()]);
    await expect(c.listPages({ rootId: 'nope' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      hint: expect.stringContaining('pages'),
    });
    // The root exists and the PATH does not — that one stays PAGE_NOT_FOUND.
    await expect(c.getPage({ rootId: 'pages', path: 'absent.md' })).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
    });
  });

  /**
   * Regressions from a code review of this branch. Each one is a place where
   * routing a previously UNBOUNDED read through a bounded core op changed an
   * answer, which is the failure mode of the whole rewiring.
   */
  describe('bounds do not change answers', () => {
    beforeEach(() => {
      const insert = db.prepare(`INSERT INTO widget (slug, format, source) VALUES (?, 'mermaid', 'graph TD')`);
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

/**
 * 0.2.13 — `--pages <dir>` / `?pages=<dir>`, against the REAL core.
 *
 * The unit test for `applyPagesOverride` asserts the root it returns, and the
 * route test stubs `findReferences` entirely. Between them they left the only
 * question that matters unasked: does a sweep over the narrowed list actually
 * read anything? It did not — the override set `referenceValidated: false`,
 * which is the exact property `findReferences` filters roots on, so every
 * `--pages` sweep answered `{ references: [], total: 0 }` and both tests stayed
 * green. This is the test that fails on that.
 */
describe('applyPagesOverride, through the core that consumes it', () => {
  let cwd: string;
  let db: Database.Database;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-pages-override-'));
    db = createTestDb();
    applyProjection(db, [widgetModule()]);
    db.prepare(`INSERT INTO widget (slug, format, source) VALUES ('flow', 'mermaid', 'graph TD')`).run();
  });
  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const build = (roots: Root[]): DiscoveryCore => {
    const pluginHost = host([widgetModule()]);
    return createDiscoveryCore({
      reader: new RawEntityReader(db, pluginHost),
      db,
      host: pluginHost,
      serialization: new SerializationEngine(pluginHost, sectionSerializer),
      roots,
      projectDir: cwd,
      packageVersion: 'test',
    });
  };

  const write = async (dir: string, rel: string, body: string): Promise<void> => {
    const abs = path.join(cwd, dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf-8');
  };

  const CITES = '# Notes\n\n<inline_mention type="widget" slug="flow"/>\n';

  it('an UNDECLARED directory is still swept — the flag is not a silent no-op', async () => {
    await write('scratch', 'draft.md', CITES);
    const configured = [pagesRoot()];

    // The whole point of the flag: `scratch` is not a configured root.
    const narrowed = build(applyPagesOverride(configured, 'scratch'));
    const found = await narrowed.findReferences({ target: 'entity', type: 'widget', slug: 'flow' });
    expect(found.total).toBe(1);
    expect(found.references[0]!.pagePath).toBe('draft.md');
  });

  it('and the narrowing is real — the configured roots are NOT swept alongside it', async () => {
    await write('pages', 'configured.md', CITES);
    await write('scratch', 'draft.md', CITES);

    const wide = build([pagesRoot()]);
    expect((await wide.findReferences({ target: 'entity', type: 'widget', slug: 'flow' })).total).toBe(1);

    const narrowed = build(applyPagesOverride([pagesRoot()], 'scratch'));
    const found = await narrowed.findReferences({ target: 'entity', type: 'widget', slug: 'flow' });
    // One hit, and it is the SCRATCH one — not the configured page, and not both.
    expect(found.total).toBe(1);
    expect(found.references[0]!.pagePath).toBe('draft.md');
  });

  it('a directory a configured root already claims is answered by that root, id intact', async () => {
    await write('pages', 'configured.md', CITES);
    const narrowed = build(applyPagesOverride([pagesRoot()], 'pages'));
    const found = await narrowed.findReferences({ target: 'entity', type: 'widget', slug: 'flow' });
    expect(found.total).toBe(1);
    expect(found.references[0]!.rootId).toBe('pages');
  });
});
