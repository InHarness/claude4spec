/**
 * 2.1.77 — what the discovery core, the section indexer and the prompt do in a
 * project WITHOUT the capability `entities`:
 *
 * - M06 L19 `7t2i8glz`: step 8 of the indexer writes no `section_entity_link`
 *   edge, and `entityEmbeds` of `get_sections` edges is empty (`sectionRefs`,
 *   `pageLinks` unchanged);
 * - M19 L19 `wjjr1oc0`: `check_consistency` runs only rules 7, 8, 13, 15, 16 —
 *   the report has no fields of the entity, tag and criteria rules;
 *   `<entity_embeds>` is not emitted;
 * - M18 `rxlzqki1`: `<tags>` is not emitted.
 *
 * Each case has its control with the capability present (the default).
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { SectionIndexerService } from '../services/section-indexer.js';
import { PagesService } from '../services/pages.js';
import { createDiscoveryCore } from './index.js';
import { RawEntityReader } from './raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { parseEdges } from './section-hydrator.js';
import type { Root } from '../../shared/types.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { RawSection } from './raw-entity-reader.js';
import { buildSystemPrompt } from '../services/chat-context.js';

/** Every slug "exists", so an absent link can only be the capability gate. */
const host = {
  listEntities: () => [],
  listAvailable: () => [],
  getEntity: () => null,
  getAvailable: () => null,
  isActive: () => false,
  entityExists: () => true,
  getEntityService: () => null,
} as unknown as ProjectPluginHost;

const pagesRoot: Root = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };

const PAGE = [
  '<!-- anchor: abcd1234 -->',
  '## Login',
  '',
  'Calls <inline_mention type="endpoint" slug="post-login"/> and see <section_ref anchor="zzzz9999"/>.',
  '',
  '## Heading without anchor',
  '',
].join('\n');

describe('project without the capability `entities` (2.1.77)', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-entities-capability-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    await pages.write('a.md', { body: PAGE });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const links = () =>
    db.prepare('SELECT anchor, entity_type, entity_slug FROM section_entity_link').all() as Array<Record<string, string>>;

  const indexer = (opts?: { entities?: boolean }) =>
    new SectionIndexerService(db, new Map([['pages', { pages }]]), { broadcast: () => {} } as never, host, opts);

  it('M06 `7t2i8glz`: step 8 writes no section→entity edge without `entities`, while the section itself is indexed', async () => {
    await indexer({ entities: false }).indexPage('pages', 'a.md');
    expect(db.prepare('SELECT anchor FROM section_index').all()).toEqual([{ anchor: 'abcd1234' }]);
    expect(links()).toEqual([]);

    // Control: with the capability the same page links its embed.
    await indexer().indexPage('pages', 'a.md');
    expect(links()).toEqual([{ anchor: 'abcd1234', entity_type: 'endpoint', entity_slug: 'post-login' }]);

    // A rebuild without the capability clears the edge a previous build left.
    await indexer({ entities: false }).indexPage('pages', 'a.md');
    expect(links()).toEqual([]);
  });

  it('M06 `7t2i8glz`: `entityEmbeds` of the outgoing edges is empty without `entities`; `sectionRefs` unchanged', () => {
    const section = { anchor: 'abcd1234', rootId: 'pages', pagePath: 'a.md' } as RawSection;
    const body = 'Calls <inline_mention type="endpoint" slug="post-login"/> and <section_ref anchor="zzzz9999"/>.';

    const without = parseEdges(db, section, body, { entities: false });
    expect(without.entityEmbeds).toEqual([]);
    expect(without.sectionRefs).toEqual([{ anchor: 'zzzz9999' }]);

    const withEntities = parseEdges(db, section, body);
    expect(withEntities.entityEmbeds).toEqual([{ tagType: 'inline_mention', type: 'endpoint', slug: 'post-login' }]);
    expect(withEntities.sectionRefs).toEqual([{ anchor: 'zzzz9999' }]);
  });

  it('M19 `wjjr1oc0`: check_consistency runs only rules 7, 8, 13, 15, 16 — the report has no entity, tag or criteria fields', async () => {
    await indexer({ entities: false }).indexPage('pages', 'a.md');
    const core = (entities?: boolean) =>
      createDiscoveryCore({
        reader: new RawEntityReader(db, host),
        db,
        host,
        serialization: new SerializationEngine(host),
        roots: [pagesRoot],
        projectDir: cwd,
        packageVersion: 'test',
        ...(entities === undefined ? {} : { entities }),
      });

    const report = await core(false).checkConsistency({});
    for (const field of [
      'brokenReferences',
      'brokenReferenceCounts',
      'orphanedEntityTags',
      'unreferencedEntities',
      'invalidTagReferences',
      'brokenAcVerifies',
      'brokenAcVerifyCounts',
      'entitiesWithoutAcCoverage',
      'modulesWithoutAc',
      'tagsWithoutConsumer',
    ]) {
      expect(report, field).not.toHaveProperty(field);
    }
    // The anchor/section/code-range rules still run: the unanchored heading (7)
    // and the broken section_ref (8) are reported.
    expect(report.unanchoredHeadings).toEqual([
      expect.objectContaining({ rootId: 'pages', pagePath: 'a.md', heading: 'Heading without anchor' }),
    ]);
    expect(report.brokenExtensionReferences).toEqual([expect.objectContaining({ tagType: 'section_ref' })]);
    expect(report).toHaveProperty('duplicateAnchors');
    expect(report).toHaveProperty('anchorLinesInCode');
    expect(report).toHaveProperty('unclosedCodeBlocks');
    // An entity rule asked for by number is skipped without an error.
    await expect(core(false).checkConsistency({ rule: 1 })).resolves.not.toHaveProperty('brokenReferences');

    // Control: with the capability the entity buckets are in the report.
    const full = await core().checkConsistency({});
    expect(full).toHaveProperty('brokenReferences');
    expect(full).toHaveProperty('tagsWithoutConsumer');
  });

  it('M19 `wjjr1oc0`, M18 `rxlzqki1`: neither `<entity_embeds>` nor `<tags>` is emitted without `entities`', () => {
    const input = {
      host,
      projectName: 'p',
      cwd: '/tmp/p',
      roots: [pagesRoot],
      currentPagePath: null,
      currentPageBody: null,
    };
    const without = buildSystemPrompt({ ...input, entities: false });
    expect(without).not.toContain('<entity_embeds');
    expect(without).not.toContain('<tags>');

    const full = buildSystemPrompt(input);
    expect(full).toContain('<entity_embeds');
    expect(full).toContain('<tags>');
  });
});
