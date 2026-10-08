import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { BriefService, type BriefServiceDeps } from './brief.js';
import { PatchService } from './patch.js';
import { MarkdownFileStore } from './pages.js';
import { FileSerializer } from './file-serializer.js';
import { FileVersionService } from './file-version.js';
import { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { hashContent } from './artifact-content.js';
import { systemRootId } from '../../shared/root-kinds.js';
import type { SelfWriteMarker } from '../fs/sources.js';

/**
 * 2.1.8 — migration 057 moved `file_version.rootId` from the bare markers
 * `brief`/`patch` to the system root ids `briefs`/`patches`, and every reader
 * queries those. The writers must stamp the same ids: a version recorded under
 * the old literal after the migration lands on a chain no reader queries — its
 * history disappears and version numbering restarts beside the migrated rows.
 * These cases write through the services and read the history back.
 */

const noopWriter: SelfWriteMarker = {
  markOrigin: () => {},
  flush: async () => {},
  suppress: () => {},
  unsuppress: () => {},
};

const rowRootIds = (db: Database.Database, p: string): string[] =>
  (db.prepare('SELECT rootId FROM file_version WHERE path = ? ORDER BY id').all(p) as Array<{ rootId: string }>).map(
    (r) => r.rootId,
  );

describe('file_version.rootId written by the brief and patch services', () => {
  let cwd: string;
  let db: Database.Database;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-fv-root-markers-'));
    db = createTestDb();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('a brief written after the migration is versioned under "briefs" and its history reads back', async () => {
    const briefsPages = new MarkdownFileStore({ cwd, dir: 'briefs', rootId: systemRootId('briefs'), kind: 'briefs' });
    await briefsPages.ensureRoot();
    const briefsSerializer = new FileSerializer(briefsPages);
    const ws = { broadcast: () => {} };
    const service = new BriefService({
      briefsPages,
      briefsWatcher: noopWriter,
      briefsSerializer,
      pageVersions: new FileVersionService(db, briefsSerializer),
      chatService: {} as BriefServiceDeps['chatService'],
      releaseService: { releaseRankByName: () => new Map<string, number>() } as unknown as BriefServiceDeps['releaseService'],
      frontmatterIndexer: new PagesFrontmatterIndexer(
        new Map([[systemRootId('briefs'), briefsPages]]),
        ws,
        new Map([[systemRootId('briefs'), 'briefs:changed']]),
      ),
      ws,
    } as unknown as BriefServiceDeps);
    const body = ['---', 'type: brief', 'from_release: r1', 'to_release: null', 'implemented: false', '---', '# Brief', ''].join(
      '\n',
    );
    await fs.writeFile(path.join(briefsPages.root, 'b.md'), body, 'utf-8');

    await service.updateFrontmatter({ path: 'b.md', patch: { implemented: true }, changedBy: 'user' });

    expect(rowRootIds(db, 'b.md')).toEqual(['briefs']);
    const history = service.listVersions('b.md');
    expect(history.map((v) => v.version)).toEqual([1]);
    expect(history[0]?.changeSummary).toBe('set implemented=true');
    // The list item carries the last version's hash — which `lastVersion` under the
    // old marker would have left empty. The item must exist first, or this passes vacuously.
    const item = service.listBriefs().find((b) => b.path === 'b.md');
    expect(item).toBeDefined();
    expect(item!.hash).toBe(hashContent(await fs.readFile(path.join(briefsPages.root, 'b.md'), 'utf-8')));
  });

  it('a patch written after the migration is versioned under "patches" and its last version reads back', async () => {
    const patchesPages = new MarkdownFileStore({ cwd, dir: 'patches', rootId: systemRootId('patches'), kind: 'patches' });
    await patchesPages.ensureRoot();
    const patchesSerializer = new FileSerializer(patchesPages);
    const ws = { broadcast: () => {} };
    const pageVersions = new FileVersionService(db, patchesSerializer);
    const service = new PatchService({
      patchesPages,
      patchesWatcher: noopWriter,
      patchesSerializer,
      pageVersions,
      chatService: {} as ConstructorParameters<typeof PatchService>[0]['chatService'],
      frontmatterIndexer: new PagesFrontmatterIndexer(
        new Map([[systemRootId('patches'), patchesPages]]),
        ws,
        new Map([[systemRootId('patches'), 'patches:changed']]),
      ),
    } as ConstructorParameters<typeof PatchService>[0]);
    const body = ['---', 'type: patch', 'brief: b.md', 'patch_kind: drift', 'applied: false', '---', '', '# Patch', ''].join('\n');
    await fs.writeFile(path.join(patchesPages.root, 'p.md'), body, 'utf-8');

    await service.updateFrontmatter({ path: 'p.md', applied: true });

    expect(rowRootIds(db, 'p.md')).toEqual(['patches']);
    expect(pageVersions.listVersions('p.md', systemRootId('patches')).map((v) => v.version)).toEqual([1]);
    expect(pageVersions.getLatestForPath('p.md', undefined, systemRootId('patches'))?.changeSummary).toBe('set applied=true');
  });
});
