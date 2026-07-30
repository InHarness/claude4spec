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
import { createDiscoveryCore } from './index.js';
import { RawEntityReader } from './raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { sectionSerializer } from '../serialization/serializers/section.js';
import type { DiscoveryCore } from './types.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import type { Root } from '../../shared/types.js';
import { DEFAULT_PAGES_ROOT_PROPS, DEFAULT_USER_ROOT_PROPS } from '../../shared/types.js';
import { z } from 'zod';

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

  it('get_entities refuses an oversized slug list rather than half-answering it', () => {
    const c = core([pagesRoot()]);
    expect(() =>
      c.getEntities({ type: 'widget', slugs: Array.from({ length: 200 }, (_, i) => `s${i}`) }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
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
