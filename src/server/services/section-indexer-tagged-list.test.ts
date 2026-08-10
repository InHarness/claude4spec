import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { PagesService } from './pages.js';
import { SectionIndexerService } from './section-indexer.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

/**
 * 0.2.15 — a `<tagged_list/>` closes `section_entity_link` for the entities it
 * lists, so a dynamic embed is a reference like any other.
 *
 * The rule pinned here is the DEFAULT. `filter` is optional, and the indexer's
 * reading of an absent one has to be the renderers' reading of it — every view
 * of these tags (`TaggedListView`, `TaggedListMixedView`, `XmlChipDispatcher`,
 * `xml-chip-preprocess`) treats anything other than `filter="or"` as AND. Read
 * the other way round, the index links entities the page does not display: the
 * embed shows what carries BOTH tags while `find_references` answers for
 * everything carrying EITHER, and a user opening the "referencing" page finds
 * no mention of the entity anywhere.
 */
const host = {
  listEntities: () => [],
  listAvailable: () => [],
  getEntity: () => null,
  getAvailable: () => null,
  isActive: () => true,
  entityExists: () => true,
  getEntityService: () => null,
} as unknown as ProjectPluginHost;

describe('section auto-linking — <tagged_list/> filter default', () => {
  let cwd: string;
  let db: Database.Database;
  let pages: PagesService;
  let indexer: SectionIndexerService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-tagged-list-'));
    db = createTestDb();
    pages = new PagesService(cwd, 'pages', 'pages');
    await pages.ensureRoot();
    indexer = new SectionIndexerService(db, new Map([['pages', { pages }]]), { broadcast: () => {} } as never, host);

    const declare = db.prepare('INSERT INTO tag (slug, name) VALUES (?, ?)');
    declare.run('auth', 'auth');
    declare.run('v2', 'v2');
    const tag = db.prepare('INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?, ?, ?)');
    tag.run('ac', 'both', 'auth');
    tag.run('ac', 'both', 'v2');
    tag.run('ac', 'auth-only', 'auth');
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function linkedSlugs(tagMarkup: string): Promise<string[]> {
    await pages.write('doc.md', { body: `# Top\n\n${tagMarkup}\n` });
    await indexer.indexPage('pages', 'doc.md');
    const rows = db
      .prepare('SELECT DISTINCT entity_slug FROM section_entity_link ORDER BY entity_slug')
      .all() as Array<{ entity_slug: string }>;
    return rows.map((r) => r.entity_slug);
  }

  it('links only the entities carrying EVERY tag when no filter is given', async () => {
    expect(await linkedSlugs('<tagged_list type="ac" tags="auth,v2"/>')).toEqual(['both']);
  });

  it('filter="or" widens it to either tag', async () => {
    expect(await linkedSlugs('<tagged_list type="ac" tags="auth,v2" filter="or"/>')).toEqual(['auth-only', 'both']);
  });

  it('filter="and" is the default said out loud', async () => {
    expect(await linkedSlugs('<tagged_list type="ac" tags="auth,v2" filter="and"/>')).toEqual(['both']);
  });
});
