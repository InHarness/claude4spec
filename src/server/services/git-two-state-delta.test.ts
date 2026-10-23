/**
 * 2.1.46 (M17 L2) — the two-state delta, the shared core of the git track:
 * `0jsqpl74` (one core, the caller picks the states), `22vm79i8` (input: two
 * states + root pathspecs, read through the M28 primitives, never the working
 * tree or the index), `87eua06x` (classification by root), `x2dmbhhk` (result:
 * the `entities`/`pages` lists of RawDelta) and `m17reldiff` (the release diff
 * from git is that core on `snapshot(vA)`, `snapshot(vB)`).
 *
 * Everything runs against a real temporary repository.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { diffEntity } from '../serialization/snapshot.js';
import type { SnapshotData } from '../serialization/types.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import { EntityStore } from './entity-store.js';
import { FileSerializer } from './file-serializer.js';
import type { FileVersionService } from './file-version.js';
import { GitService } from './git.js';
import { computeTwoStateDelta, type DeltaDeps, type DeltaRoots } from './git-two-state-delta.js';
import type { PagesService } from './pages.js';
import { ReleaseService } from './release.js';
import { ReleaseFileStore } from './release-store.js';
import type { TagsService } from './tags.js';
import type { VersionService } from './versions.js';

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

const pageSerializer = new FileSerializer({} as unknown as ConstructorParameters<typeof FileSerializer>[0]);

/** A host whose `diff` is the real schema-less host diff, recorded so a test can read what it was given. */
function makeHost() {
  const diff = vi.fn((type: string, a: SnapshotData, b: SnapshotData) => diffEntity({ getEntity: () => null }, type, a, b));
  return {
    host: { getEntity: () => null, listEntities: () => [], getAvailable: () => true, diff } as unknown as DeltaDeps['host'],
    diff,
  };
}

function entityFile(payload: Record<string, unknown>, stamp: { createdAt: string; updatedAt: string }, payloadVersion = 1): string {
  return JSON.stringify({ ...payload, ...stamp, payloadVersion }, null, 2) + '\n';
}

describe('M17 two-state delta core (2.1.46)', () => {
  let dir: string;
  let pagesDir: string;
  let entitiesDir: string;
  let releasesDir: string;
  let gitService: GitService;

  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const commit = async (msg: string): Promise<string> => {
    await git(['add', '-A'], dir);
    await git(['commit', '-m', msg], dir);
    return (await git(['rev-parse', 'HEAD'], dir)).trim();
  };

  const T0 = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const T1 = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' };

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-two-state-delta-')));
    pagesDir = path.join(dir, 'pages');
    entitiesDir = path.join(dir, '.claude4spec', 'entities');
    releasesDir = path.join(dir, '.claude4spec', 'releases');
    await git(['init', '-b', 'main'], dir);
    await git(['config', 'user.email', 'test@example.com'], dir);
    await git(['config', 'user.name', 'Test'], dir);
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: true } }, null, 2));
    fs.mkdirSync(pagesDir, { recursive: true });
    gitService = new GitService(dir, [pagesDir]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function roots(): DeltaRoots {
    return {
      pathspecs: [pagesDir, entitiesDir, releasesDir],
      pageRoots: new Map([['pages', pagesDir]]),
      entities: {
        dir: entitiesDir,
        parseRelPath: (rel) => {
          const m = /^([a-z0-9-]+)\/([^/]+)\.json$/.exec(rel);
          return m ? { type: m[1]!, slug: m[2]! } : null;
        },
      },
      excluded: [releasesDir],
    };
  }

  /** C1 → C2: a page modified, one deleted, one created; an entity edited, one stamp-only, one created; a release file; a file outside the pathspecs. */
  async function seed(): Promise<{ c1: string; c2: string }> {
    write('pages/a.md', 'A old');
    write('pages/gone.md', 'Gone bye');
    write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v1' }, T0));
    write('.claude4spec/entities/endpoint/e2.json', entityFile({ summary: 'steady' }, T0));
    write('.claude4spec/releases/v1.json', JSON.stringify({ name: 'v1' }));
    write('other/x.md', '# X\n\none\n');
    const c1 = await commit('C1');

    write('pages/a.md', 'A new');
    fs.rmSync(path.join(pagesDir, 'gone.md'));
    write('pages/new.md', 'New hello');
    write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v2' }, T1));
    // System fields only: a later `updatedAt` and a payload marker bump.
    write('.claude4spec/entities/endpoint/e2.json', entityFile({ summary: 'steady' }, T1, 2));
    write('.claude4spec/entities/endpoint/e3.json', entityFile({ summary: 'fresh' }, T1));
    write('.claude4spec/releases/v2.json', JSON.stringify({ name: 'v2' }));
    write('other/x.md', '# X\n\ntwo\n');
    const c2 = await commit('C2');
    return { c1, c2 };
  }

  const ops = (d: { entities: Array<{ slug: string; op: string }>; pages: Array<{ path: string; op: string }> }) => ({
    entities: d.entities.map((e) => `${e.slug}:${e.op}`).sort(),
    pages: d.pages.map((p) => `${p.path}:${p.op}`).sort(),
  });

  it('[section:0jsqpl74] one core for every git-track use: the caller picks the two states — a commit pair, the reversed pair, or a tree on the right (the shadow-comparison shape)', async () => {
    const { c1, c2 } = await seed();
    const { host } = makeHost();
    const deps: DeltaDeps = { git: gitService, pageSerializer, host };

    const forward = await computeTwoStateDelta(deps, c1, c2, roots());
    expect(ops(forward!)).toEqual({
      entities: ['e1:updated', 'e3:created'],
      pages: ['a.md:modified', 'gone.md:deleted', 'new.md:created'],
    });

    // Which state is which side is the caller's decision: swapped, the same core answers the reverse.
    const backward = await computeTwoStateDelta(deps, c2, c1, roots());
    expect(ops(backward!)).toEqual({
      entities: ['e1:updated', 'e3:deleted'],
      pages: ['a.md:modified', 'gone.md:created', 'new.md:deleted'],
    });

    // A tree is a state too — the right side of a shadow comparison is a trial-merge tree.
    const tree = (await git(['rev-parse', `${c2}^{tree}`], dir)).trim();
    expect(await computeTwoStateDelta(deps, c1, tree, roots())).toEqual(forward);
  });

  it('[section:22vm79i8] input is two states and the root pathspecs; files are listed and read only through the M28 primitives at those states — never the working tree or the index, and the repository is left untouched', async () => {
    const { c1, c2 } = await seed();
    // Uncommitted work: a working-tree edit, an untracked page, a staged page.
    write('pages/a.md', 'A working tree');
    write('pages/untracked.md', '# Untracked\n');
    write('pages/staged.md', '# Staged\n');
    await git(['add', 'pages/staged.md'], dir);

    const repoState = async (): Promise<string[]> => [
      await git(['status', '--porcelain=v1', '-uall'], dir),
      await git(['rev-parse', 'HEAD'], dir),
      await git(['for-each-ref'], dir),
      await git(['ls-files', '-s'], dir),
      fs.readFileSync(path.join(pagesDir, 'a.md'), 'utf8'),
    ];
    const before = await repoState();

    const diffRefs = vi.spyOn(gitService, 'diffRefs');
    const showFile = vi.spyOn(gitService, 'showFile');
    const { host } = makeHost();
    const delta = await computeTwoStateDelta({ git: gitService, pageSerializer, host }, c1, c2, roots());

    // The file list: one M28 call, at the two states, over the given pathspecs.
    expect(diffRefs).toHaveBeenCalledTimes(1);
    expect(diffRefs).toHaveBeenCalledWith(c1, c2, [pagesDir, entitiesDir, releasesDir], { detected: true, rootPath: dir });
    // Every content read is a file-in-a-state read at one of the two states.
    expect(showFile.mock.calls.length).toBeGreaterThan(0);
    for (const [state] of showFile.mock.calls) expect([c1, c2]).toContain(state);

    // Nothing of the working tree or the index reaches the delta.
    const pagePaths = delta!.pages.map((p) => p.path);
    expect(pagePaths).not.toContain('untracked.md');
    expect(pagePaths).not.toContain('staged.md');
    const a = delta!.pages.find((p) => p.path === 'a.md')!;
    const lines = a.modified_sections.flatMap((s) => s.line_diff.lines);
    expect(lines.some((l) => l.op === 'added' && l.content === 'A new')).toBe(true);
    expect(lines.some((l) => l.content === 'A working tree')).toBe(false);
    // Outside the pathspecs: `other/x.md` changed between the states, but is not in the delta.
    expect(pagePaths.some((p) => p.includes('x.md'))).toBe(false);

    // Read-only: working tree, index, HEAD and refs exactly as before.
    expect(await repoState()).toEqual(before);
  });

  it('[review:rev-0001][section:0jsqpl74] the core probes the repository once per diff — one `rev-parse`, shared by the file list and every file read, no full `detect()` — and spawns nothing when git is off', async () => {
    const { c1, c2 } = await seed();
    const { host } = makeHost();
    const probeRepo = vi.spyOn(gitService, 'probeRepo');
    const detect = vi.spyOn(gitService, 'detect');
    const diffRefs = vi.spyOn(gitService, 'diffRefs');
    const showFile = vi.spyOn(gitService, 'showFile');
    const spawns = vi.spyOn(gitService as unknown as { git: (args: string[], cwd: string) => Promise<unknown> }, 'git');

    const delta = await computeTwoStateDelta({ git: gitService, pageSerializer, host }, c1, c2, roots());
    expect(delta).not.toBeNull();

    // One probe, and it is the light one: `detect()` (remote, branch, a whole-tree `status`) never runs.
    expect(probeRepo).toHaveBeenCalledTimes(1);
    expect(detect).not.toHaveBeenCalled();
    const probe = await probeRepo.mock.results[0]!.value;
    expect(probe).toEqual({ detected: true, rootPath: dir });
    // The very same probe reaches the file list and every file read.
    expect(diffRefs).toHaveBeenCalledTimes(1);
    expect(diffRefs.mock.calls[0]![3]).toBe(probe);
    expect(showFile.mock.calls.length).toBeGreaterThan(0);
    for (const call of showFile.mock.calls) expect(call[2]).toBe(probe);
    // Git subprocesses: one `rev-parse --show-toplevel`, one `diff`, and only `show`s besides.
    const verbs = spawns.mock.calls.map(([args]) => args.find((a) => !a.startsWith('-') && !a.includes('=')));
    expect(verbs.filter((v) => v === 'rev-parse')).toHaveLength(1);
    expect(verbs.filter((v) => v === 'diff')).toHaveLength(1);
    expect(verbs.filter((v) => v !== 'rev-parse' && v !== 'diff').every((v) => v === 'show')).toBe(true);
    expect(verbs.filter((v) => v === 'show')).toHaveLength(showFile.mock.calls.length);

    // Git off: no probe subprocess, no file list — `null` straight away.
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2));
    spawns.mockClear();
    diffRefs.mockClear();
    expect(await computeTwoStateDelta({ git: gitService, pageSerializer, host }, c1, c2, roots())).toBeNull();
    expect(spawns).not.toHaveBeenCalled();
    expect(diffRefs).not.toHaveBeenCalled();
  });

  it('[section:87eua06x] a differing file enters the delta by its root: page root → M02 page diff of both contents; entities root → host entity diff of both payloads; releases root → nothing; system-fields-only change → no entry', async () => {
    const { c1, c2 } = await seed();
    const { host, diff } = makeHost();
    const delta = (await computeTwoStateDelta({ git: gitService, pageSerializer, host }, c1, c2, roots()))!;

    // Pages: the M02 section diff on the file's content on both sides.
    const byPath = new Map(delta.pages.map((p) => [p.path, p]));
    const a = byPath.get('a.md')!;
    expect(a).toMatchObject({ rootId: 'pages', op: 'modified' });
    const aLines = a.modified_sections[0]!.line_diff.lines;
    expect(aLines.some((l) => l.op === 'removed' && l.content === 'A old')).toBe(true);
    expect(aLines.some((l) => l.op === 'added' && l.content === 'A new')).toBe(true);
    expect(byPath.get('new.md')).toMatchObject({ op: 'created' });
    expect(byPath.get('new.md')!.added_sections[0]?.content).toBe('New hello');
    expect(byPath.get('gone.md')).toMatchObject({ op: 'deleted' });
    expect(byPath.get('gone.md')!.removed_sections[0]?.content).toBe('Gone bye');

    // Entities: the host diff, fed both sides' payloads — without the envelope.
    expect(delta.entities.find((e) => e.slug === 'e1')).toMatchObject({ type: 'endpoint', op: 'updated' });
    expect(delta.entities.find((e) => e.slug === 'e3')).toMatchObject({ type: 'endpoint', op: 'created' });
    expect(diff).toHaveBeenCalledWith('endpoint', { summary: 'v1' }, { summary: 'v2' });
    expect(diff).toHaveBeenCalledWith('endpoint', null, { summary: 'fresh' });

    // e2 differs only in `updatedAt` and the payload marker — no entry.
    expect(diff).toHaveBeenCalledWith('endpoint', { summary: 'steady' }, { summary: 'steady' });
    expect(delta.entities.some((e) => e.slug === 'e2')).toBe(false);

    // The releases root is not delta content: `v2.json` was added, and appears nowhere.
    expect(JSON.stringify(delta)).not.toContain('v2.json');
    expect(delta.pages).toHaveLength(3);
    expect(delta.entities).toHaveLength(2);
  });

  it('[section:x2dmbhhk] the result is the entity and page lists in the shape of RawDelta `entities`/`pages` — and nothing about releases', async () => {
    const { c1, c2 } = await seed();
    const { host } = makeHost();
    const delta = (await computeTwoStateDelta({ git: gitService, pageSerializer, host }, c1, c2, roots()))!;

    // Only the two lists: which side is which release is the caller's to add.
    expect(Object.keys(delta).sort()).toEqual(['entities', 'pages']);
    for (const e of delta.entities) {
      expect(Object.keys(e).sort()).toEqual(['changes', 'op', 'slug', 'type']);
      expect(Array.isArray(e.changes)).toBe(true);
    }
    for (const p of delta.pages) {
      expect(Object.keys(p)).toEqual(
        expect.arrayContaining([
          'rootId', 'path', 'op', 'added_sections', 'removed_sections', 'modified_sections', 'moved_sections',
          'frontmatter_diff', 'xml_refs_diff',
        ]),
      );
    }

    // No file list (git off) → `null`, for the caller to interpret.
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2));
    expect(await computeTwoStateDelta({ git: gitService, pageSerializer, host }, c1, c2, roots())).toBeNull();
  });

  it('[section:m17reldiff] release_diff(vA, vB) from git is the two-state core on snapshot(vA) = M_next~1 and snapshot(vB) = HEAD — one file list, no direct ref diff of its own', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    try {
      const { host, diff } = makeHost();
      const releaseStore = new ReleaseFileStore(dir, '.claude4spec/releases', { suppress: () => {} } as SelfWriteSuppressor);
      releaseStore.ensureRoot();
      const releaseService = new ReleaseService(
        db,
        host as unknown as PluginHost,
        {} as unknown as VersionService,
        { assignToRelease: () => {} } as unknown as FileVersionService,
        pageSerializer,
        {} as unknown as RawEntityReader,
        {} as unknown as TagsService,
        {} as unknown as PagesService,
        () => null,
        dir,
        ['pages'],
        [pagesDir],
      );
      releaseService.setReleaseStore(releaseStore);
      releaseService.setGitService(gitService);
      releaseService.setReleaseFlagRootDirs([pagesDir, entitiesDir]);
      releaseService.setEntityStore(
        new EntityStore(dir, '.claude4spec/entities', { suppress: () => {} } as SelfWriteSuppressor, {} as RawEntityReader, host as unknown as PluginHost),
      );
      const cut = (name: string, createdAt: string): number => {
        releaseStore.write(name, { name, slug: name, description: name, createdAt, createdBy: 'user', roots: ['pages'] });
        return Number(
          db
            .prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES (?, ?, ?, 'user', ?)`)
            .run(name, name, name, createdAt).lastInsertRowid,
        );
      };

      write('pages/a.md', 'A old');
      write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v1' }, T0));
      const v1 = cut('v1', '2026-01-01T00:00:00.000Z');
      await commit('v1');
      write('pages/a.md', 'A new');
      write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v2' }, T1));
      const v2 = cut('v2', '2026-02-01T00:00:00.000Z');
      const markerV2 = await commit('v2');

      const diffRefs = vi.spyOn(gitService, 'diffRefs');
      const delta = await releaseService.getReleaseDiff(v1, v2);

      // One M28 file list, at the two reign snapshots — the core's; nothing else diffs refs.
      expect(diffRefs).toHaveBeenCalledTimes(1);
      expect(diffRefs.mock.calls[0]!.slice(0, 2)).toEqual([`${markerV2}~1`, 'HEAD']);
      // The entity row is the core's host diff of both payloads (envelope stripped), not a file-status row.
      expect(diff).toHaveBeenCalledWith('endpoint', { summary: 'v1' }, { summary: 'v2' });

      // The answer is exactly the core's on those states, with the caller's release meta on top.
      const expected = await computeTwoStateDelta(
        { git: gitService, pageSerializer, host },
        `${markerV2}~1`,
        'HEAD',
        {
          pathspecs: [pagesDir, entitiesDir, releasesDir],
          pageRoots: new Map([['pages', pagesDir]]),
          entities: { dir: entitiesDir, parseRelPath: (rel) => (rel === 'endpoint/e1.json' ? { type: 'endpoint', slug: 'e1' } : null) },
          excluded: [releasesDir],
        },
      );
      expect(delta).toEqual({ from: { id: v1, name: 'v1' }, to: { id: v2, name: 'v2' }, ...expected });
      expect(delta.entities).toEqual([{ type: 'endpoint', slug: 'e1', op: 'updated', changes: [] }]);
      expect(delta.pages.map((p) => `${p.path}:${p.op}`)).toEqual(['a.md:modified']);
    } finally {
      db.close();
    }
  });
});
