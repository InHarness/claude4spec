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
import type { DiscoveryCore } from './types.js';
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

    const beta = await core.getSection({ anchor: anchorOf('Beta') });

    expect(beta.body).toContain('BETA BODY LINE');
    // The frontmatter shift dragged the PREVIOUS section in and cut this one's tail.
    expect(beta.body).not.toContain('ALPHA BODY LINE');
    expect(beta.body).not.toContain('title: A page with frontmatter');

    const alpha = await core.getSection({ anchor: anchorOf('Alpha') });
    expect(alpha.body).toContain('ALPHA BODY LINE');
    expect(alpha.body).not.toContain('BETA BODY LINE');
  });

  it('reports a section size that matches the body it will return', async () => {
    await index('fm2.md', ['---', 'title: X', '---', '', '# Top', '', '## Only', '', 'measured content', ''].join('\n'));

    const listed = await core.listSections({ by: 'page', rootId: 'pages', path: 'fm2.md' });
    const row = listed.items.find((s) => s.heading === 'Only');
    const fetched = await core.getSection({ anchor: row!.anchor });

    // `size` exists so a caller can decide whether to fetch. A size that
    // describes different bytes than the fetch returns is worse than none.
    expect(row!.size).toBe(Buffer.byteLength(fetched.body, 'utf8'));
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
});
