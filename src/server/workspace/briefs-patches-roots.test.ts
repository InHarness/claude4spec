import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { FileWatchRuntime, type WatchSubscriber } from '../fs/watcher.js';
import { ReactionBinder } from '../fs/reactions.js';
import { RootRegistry } from '../roots/registry.js';
import { validateRootDirs } from '../config.js';
import { BRIEF_HEADER, KIND_DECLARATIONS, PATCH_HEADER } from '../../shared/root-kinds.js';
import type { Root, WsEvent } from '../../shared/types.js';
import { FileVersionService } from '../services/file-version.js';
import { FileVersionCapture } from '../services/file-version-capture.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { BriefService, type BriefServiceDeps } from '../services/brief.js';
import { buildBriefToolsServer } from '../mcp/brief-tools.js';
import { artifactRegistry } from '../services/artifact-registry.js';
import { M21_PROMPT_BLOCKS } from '../services/system-prompt/blocks/m21-brief.js';
import { registerCoreReactions, type CoreReactionContext } from './core-reactions.js';
import { bindRegistryReactions, mountRegistryRoots } from './root-registry-runtime.js';

/**
 * 2.1.8 — M21 declares the root kind `briefs` (bcpvtk7p) and M23 the root kind
 * `patches` (yp20j51v). The L13 implementor registers both system roots in
 * code, mounts their sources, builds their file stores and binds the reactions
 * the kinds select; `file_version` rows and frontmatter records are keyed by the
 * root ids `briefs` / `patches`. Deterministic watcher mode (`fsEvents: false`):
 * `flush` runs the chain as an outside edit (`origin: 'external'`).
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];
const dbs: Database.Database[] = [];

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of dbs.splice(0)) d.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

registerCoreReactions();

const NOOP: WatchSubscriber = { onChange: () => {}, onUnlink: () => {} };
const USER_ROOTS: Root[] = [{ id: 'docs', name: 'Docs', dir: 'docs', builtin: true }];

const BRIEF = [
  '---',
  'type: brief',
  'from_release: v1',
  'to_release: v2',
  "generated_at: '2026-01-01T00:00:00.000Z'",
  'implemented: false',
  '---',
  '# Brief: v1 → v2',
  '',
  '## Changes',
  '',
  'first draft',
  '',
].join('\n');

/**
 * The registry built and bound the way the context build does it — with the
 * real `m17-capture` (a `FileVersionCapture` over the capture serializers) and
 * the real `m02-frontmatter-indexer` — plus a `BriefService` over the store of
 * the `briefs` root, taken from the registry BY KIND.
 */
async function boundArtifactRoots() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-briefs-root-'));
  tmpDirs.push(cwd);
  const db = createTestDb();
  dbs.push(db);
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(runtime);
  const w = runtime.scoped('context:p1#1');
  const registry = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });

  const briefsRoot = registry.system('briefs');
  const patchesRoot = registry.system('patches');
  const briefs = mounted.artifactMounts.get('brief')!;
  const patches = mounted.artifactMounts.get('patch')!;
  const events: WsEvent[] = [];
  const ws = { broadcast: (e: WsEvent) => void events.push(e) } as unknown as CoreReactionContext['ws'];

  const versions = new FileVersionService(db, briefs.serializer);
  const capture = new FileVersionCapture(
    versions,
    new Map([
      [briefs.rootId, briefs.serializer],
      [patches.rootId, patches.serializer],
    ]),
    () => undefined,
  );
  const indexer = new PagesFrontmatterIndexer(
    new Map([
      [briefs.rootId, briefs.store],
      [patches.rootId, patches.store],
    ]),
    ws,
    new Map([
      [briefs.rootId, 'briefs:changed'],
      [patches.rootId, 'patches:changed'],
    ]),
  );
  const ctx: CoreReactionContext = {
    ws,
    frontmatterIndexer: indexer,
    anchorInjectionFor: () => NOOP,
    sectionIndexer: NOOP,
    todosIndexer: NOOP,
    linkIndexer: NOOP,
    versionCapture: capture,
    entityIndexer: NOOP,
    releaseIndexer: NOOP,
  };
  const binder = new ReactionBinder(w, ctx);
  bindRegistryReactions(registry, mounted.sourceByRootId, binder);

  const briefService = new BriefService({
    briefsPages: briefs.store,
    briefsWatcher: briefs.writer,
    briefsRecords: briefs.store.records,
    briefsSerializer: briefs.serializer,
    pageVersions: versions,
    chatService: { threadCountForBrief: () => 0 } as unknown as BriefServiceDeps['chatService'],
    releaseService: {
      getLatestReleaseName: () => 'v1',
      getRelease: (name: string) => ({ name }),
      releaseRankByName: () => new Map([['v1', 0], ['v2', 1]]),
    } as unknown as BriefServiceDeps['releaseService'],
    frontmatterIndexer: indexer,
    ws,
  });

  return { cwd, db, w, registry, mounted, briefsRoot, patchesRoot, briefs, patches, binder, versions, indexer, briefService };
}

/** `update_brief` on the thread's brief, the way a `context_type='brief'` turn calls it. */
async function threadTools(briefService: BriefService, briefPath: string) {
  const { server } = buildBriefToolsServer({ threadId: 't1', briefPath, briefService });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'brief-thread', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  };
}

const rows = (db: Database.Database, p: string) =>
  db
    .prepare('SELECT rootId, op, changed_by AS changedBy, version FROM file_version WHERE path = ? ORDER BY id')
    .all(p) as Array<{ rootId: string; op: string; changedBy: string; version: number }>;

describe('M21 / M23 — the `briefs` and `patches` root kinds (2.1.8)', () => {
  it('declares the briefs kind: one code root `.claude4spec/briefs`, `*.md` with the brief header on `file_version`, gitignore only, indexer + capture', async () => {
    expect(KIND_DECLARATIONS.briefs).toEqual({
      kind: 'briefs',
      source: 'code',
      sidebar: 'hidden',
      fileMap: [{ pattern: '*.md', format: 'markdown', track: 'file_version', header: BRIEF_HEADER }],
      flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
      reactions: ['m02-frontmatter-indexer', 'm17-capture'],
    });
    expect(BRIEF_HEADER).toEqual({
      type: 'brief',
      immutable: ['type', 'from_release', 'to_release', 'generated_at', 'roots'],
      mutable: ['implemented'],
    });

    const { briefsRoot, briefs, mounted, binder } = await boundArtifactRoots();
    expect(briefsRoot).toEqual({ id: 'briefs', name: 'Briefs', dir: '.claude4spec/briefs', kind: 'briefs', builtin: false });
    expect(briefs.store.rootId).toBe('briefs');
    const source = mounted.sourceByRootId.get('briefs')!;
    for (const id of ['m02-frontmatter-indexer', 'm17-capture', 'm02-file-changed']) {
      expect(binder.isBound(id, source), id).toBe(true);
    }
    // No injected anchors and no section index on a brief.
    expect(binder.isBound('m06-anchor-injection', source)).toBe(false);
    expect(binder.isBound('m06-section-indexer', source)).toBe(false);
    // M36 keeps only the thread binding for the kind.
    expect(artifactRegistry.briefs).toEqual({
      binding: { mode: 'anchor', contextType: 'brief', threadColumn: 'brief_path' },
      danglingPolicy: 'invariant-banner',
    });
  });

  it('declares the patches kind: one code root `.claude4spec/patches`, `*.md` with the patch header on `file_version`, gitignore only, indexer + capture', async () => {
    expect(KIND_DECLARATIONS.patches).toEqual({
      kind: 'patches',
      source: 'code',
      sidebar: 'hidden',
      fileMap: [{ pattern: '*.md', format: 'markdown', track: 'file_version', header: PATCH_HEADER }],
      flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
      reactions: ['m02-frontmatter-indexer', 'm17-capture'],
    });
    expect(PATCH_HEADER).toEqual({
      type: 'patch',
      immutable: ['type', 'brief', 'patch_kind', 'created_at', 'created_by'],
      mutable: ['applied'],
    });

    const { patchesRoot, patches, mounted, binder } = await boundArtifactRoots();
    expect(patchesRoot).toEqual({ id: 'patches', name: 'Patches', dir: '.claude4spec/patches', kind: 'patches', builtin: false });
    expect(patches.store.rootId).toBe('patches');
    const source = mounted.sourceByRootId.get('patches')!;
    for (const id of ['m02-frontmatter-indexer', 'm17-capture', 'm02-file-changed']) {
      expect(binder.isBound(id, source), id).toBe(true);
    }
    expect(binder.isBound('m06-anchor-injection', source)).toBe(false);
    expect(binder.isBound('m06-section-indexer', source)).toBe(false);
    expect(artifactRegistry.patches).toEqual({
      binding: { mode: 'anchor', contextType: 'patch', threadColumn: 'patch_path' },
      danglingPolicy: 'invariant-banner',
    });
  });

  it('a user root overlapping the fixed `patches` directory is a hard D4 error; the briefs/patches dirs come from no config key', () => {
    const overlapping: Root[] = [...USER_ROOTS, { id: 'drift', name: 'Drift', dir: '.claude4spec/patches', builtin: false }];
    expect(validateRootDirs(overlapping).errors).toEqual(["config.json: 'drift' overlaps write-target 'patches'"]);
    const inside: Root[] = [...USER_ROOTS, { id: 'sub', name: 'Sub', dir: '.claude4spec/patches/sub', builtin: false }];
    expect(validateRootDirs(inside).errors).toEqual(["config.json: 'sub' overlaps write-target 'patches'"]);
    // A root at `.` does not reach the dot-subtree `.claude4spec/*`.
    expect(validateRootDirs([{ id: 'all', name: 'All', dir: '.', builtin: true }]).errors).toEqual([]);
  });

  it('[ac:ac-brief-nie-jest-page-rootem-zyje-w-bri] a brief lives in the system root `briefs` and its `file_version` rows carry rootId "briefs"', async () => {
    const { cwd, db, w, registry, mounted, briefService, indexer } = await boundArtifactRoots();

    // Created through the service: the file lands in `.claude4spec/briefs`.
    const created = await briefService.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2' });
    expect(created.briefPath).toBe('v1-to-v2.md');
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'briefs', 'v1-to-v2.md'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'docs', 'v1-to-v2.md'))).toBe(false);
    expect(rows(db, 'v1-to-v2.md').map((r) => r.rootId)).toEqual(['briefs']);

    // A brief dropped into the root from outside is captured by the kind's
    // `m17-capture` under the same root id, and indexed under it.
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'briefs', 'v2-to-v3.md'), BRIEF.replace(/v2/g, 'v3').replace(/v1/g, 'v2'));
    await w.flush(mounted.sourceByRootId.get('briefs')!, 'v2-to-v3.md');
    expect(rows(db, 'v2-to-v3.md')).toEqual([{ rootId: 'briefs', op: 'create', changedBy: 'filesystem', version: 1 }]);
    expect(indexer.findByFrontmatterType('brief').map((r) => [r.rootId, r.path]).sort()).toEqual([
      ['briefs', 'v1-to-v2.md'],
      ['briefs', 'v2-to-v3.md'],
    ]);

    // The root is a system root of kind `briefs`, not one of the page roots.
    expect(registry.pages().map((r) => r.id)).toEqual(['docs']);
    expect(registry.get('briefs')?.kind).toBe('briefs');
    expect(briefService.listBriefs().map((b) => b.path).sort()).toEqual(['v1-to-v2.md', 'v2-to-v3.md']);
  });

  it('[ac:ac-wersjonowanie-briefu-reuse-uje-tabele] every change — from disk, from the UI, from the agent — adds a `file_version` row under rootId "briefs" with its `changedBy`, and no new table', async () => {
    const { cwd, db, w, mounted, briefService } = await boundArtifactRoots();

    // filesystem: an edit outside the app, captured by the bound reaction.
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'briefs', 'b.md'), BRIEF);
    await w.flush(mounted.sourceByRootId.get('briefs')!, 'b.md');

    // user: a save from the editor (REST PUT content → `updateContent`, changedBy 'user').
    const read1 = await briefService.getBrief('b.md');
    await briefService.updateContent({
      path: 'b.md',
      content: read1.content.replace('first draft', 'user draft'),
      expectedHash: read1.hash,
      changedBy: 'user',
    });

    // agent: `update_brief` from the brief thread.
    const call = await threadTools(briefService, 'b.md');
    const read2 = await call('get_brief', {});
    const res = await call('update_brief', { action: 'append', content: 'agent paragraph', expectedHash: read2.body.hash });
    expect(res.isError).toBe(false);

    expect(rows(db, 'b.md')).toEqual([
      { rootId: 'briefs', op: 'create', changedBy: 'filesystem', version: 1 },
      { rootId: 'briefs', op: 'update', changedBy: 'user', version: 2 },
      { rootId: 'briefs', op: 'update', changedBy: 'agent', version: 3 },
    ]);
    expect(briefService.listVersions('b.md').map((v) => v.changedBy)).toEqual(
      expect.arrayContaining(['filesystem', 'user', 'agent']),
    );
    // No table of its own: the brief's history is `file_version` only.
    const briefTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%brief%'")
      .all() as Array<{ name: string }>;
    expect(briefTables).toEqual([]);
  });

  it('[ac:ac-mcp-update-brief-wywoluje-recordversi] MCP update_brief calls recordVersion(path, "update", "agent") on the same axis as user and disk edits', async () => {
    const { cwd, w, mounted, briefService, versions, briefs } = await boundArtifactRoots();
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'briefs', 'b.md'), BRIEF);
    await w.flush(mounted.sourceByRootId.get('briefs')!, 'b.md');

    const record = vi.spyOn(versions, 'recordVersion');
    const call = await threadTools(briefService, 'b.md');
    const read = await call('get_brief', {});
    const res = await call('update_brief', {
      action: 'replace',
      content: '# Brief: v1 → v2\n\nrewritten by the agent\n',
      expectedHash: read.body.hash,
    });
    expect(res.isError).toBe(false);
    expect(Object.keys(res.body)).toEqual(['newHash']);

    expect(record).toHaveBeenCalledTimes(1);
    const [relPath, op, changedBy, , serializer, rootId] = record.mock.calls[0]!;
    expect([relPath, op, changedBy]).toEqual(['b.md', 'update', 'agent']);
    expect(serializer).toBe(briefs.serializer);
    expect(rootId).toBe('briefs');
    // One axis: the disk-created v1 and the agent's v2 are the same history.
    expect(briefService.listVersions('b.md').map((v) => [v.version, v.changedBy])).toEqual(
      expect.arrayContaining([
        [1, 'filesystem'],
        [2, 'agent'],
      ]),
    );
  });

  it('[ac:ac-w-initial-generation-pierwsza-tura-wa] initial generation: the brief turn is told to write the release_diff narrative with ONE update_brief({ action: \'replace\', content }), and that call replaces the heading-only body', async () => {
    // The tool-usage block every brief turn carries names the first write.
    const usage = M21_PROMPT_BLOCKS.find((b) => b.name === 'brief_tools_usage')!.render(
      {} as Parameters<(typeof M21_PROMPT_BLOCKS)[number]['render']>[0],
    )!;
    expect(usage).toContain("initial generation — the first write of a fresh brief (only its heading so far) is ONE update_brief({ action: 'replace', content })");
    expect(usage).toContain('the narrative you built from release_diff');

    // The modal's brief starts as frontmatter + its heading only.
    const { db, briefService } = await boundArtifactRoots();
    const { briefPath } = await briefService.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2' });
    const fresh = await briefService.getBrief(briefPath);
    expect(fresh.body.trim()).toBe('# Brief: v1 → v2');

    // The first turn's write: replace with the narrative distilled from release_diff.
    const narrative = '# Brief: v1 → v2\n\nThe `orders` endpoint gained a `status` field (`string`).\n';
    const call = await threadTools(briefService, briefPath);
    const read = await call('get_brief', {});
    const res = await call('update_brief', { action: 'replace', content: narrative, expectedHash: read.body.hash });
    expect(res.isError).toBe(false);

    const after = await briefService.getBrief(briefPath);
    expect(after.body).toBe(narrative);
    expect(after.frontmatter).toMatchObject({ type: 'brief', from_release: 'v1', to_release: 'v2', implemented: false });
    expect(rows(db, briefPath).map((r) => [r.op, r.changedBy])).toEqual([
      ['create', 'user'],
      ['update', 'agent'],
    ]);
  });
});
