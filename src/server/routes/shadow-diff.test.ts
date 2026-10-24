/**
 * 2.1.46 (M17) — the shadow comparison `GET /api/shadow-diff` (endpoint
 * `get-api-shadow-diff`, dto `shadow-diff-response`, spec-operation
 * `shadow-diff`): `ReleaseService.shadowDiff` → `computeShadowDiff` over the
 * M28 primitives and the M17 two-state delta core.
 *
 * Everything runs against a real temporary repository: the master on `main`,
 * shadows as `refs/runs/<id>` refs grown from an older master commit. The trial
 * merge needs git ≥ 2.38; its version is INJECTED (the `gitVersion` read the
 * M28 gate uses), so the old-git path never depends on the host's git.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { diffEntity } from '../serialization/snapshot.js';
import type { SnapshotData } from '../serialization/types.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { RawEntityReader } from '../discovery/raw-entity-reader.js';
import type { SelfWriteSuppressor } from '../fs/sources.js';
import { EntityStore } from '../services/entity-store.js';
import { FileSerializer } from '../services/file-serializer.js';
import type { FileVersionService } from '../services/file-version.js';
import { GitRepoLock, GitService } from '../services/git.js';
import type { PagesService } from '../services/pages.js';
import { ReleaseService } from '../services/release.js';
import { ReleaseFileStore } from '../services/release-store.js';
import type { TagsService } from '../services/tags.js';
import type { VersionService } from '../services/versions.js';
import type { ShadowDiffResponse } from '../../shared/entities.js';
import { errorHandler } from './errors.js';
import { releasesRouter } from './releases.js';
import { shadowDiffRouter } from './shadow-diff.js';

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

const pageSerializer = new FileSerializer({} as unknown as ConstructorParameters<typeof FileSerializer>[0]);
const host = {
  getEntity: () => null,
  listEntities: () => [],
  getAvailable: () => true,
  diff: (type: string, a: SnapshotData, b: SnapshotData) => diffEntity({ getEntity: () => null }, type, a, b),
} as unknown as PluginHost;

const STAMP = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1 };
const entityFile = (payload: Record<string, unknown>): string => JSON.stringify({ ...payload, ...STAMP }, null, 2) + '\n';

type GitVersionHolder = { gitVersion(): Promise<string | null> };

describe('M17 shadow diff — GET /api/shadow-diff (2.1.46)', () => {
  let dir: string;
  let pagesDir: string;
  let db: Database.Database;
  let gitService: GitService;
  let releaseService: ReleaseService;
  let app: express.Express;
  let n = 0;
  /** The master commits of the base scenario. */
  let c1: string;
  let c2: string;

  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const commitAll = async (message: string, body?: string): Promise<string> => {
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', message, ...(body ? ['-m', body] : [])], dir);
    return (await git(['rev-parse', 'HEAD'], dir)).trim();
  };
  /** A `refs/runs/<id>` ref: `edit()` on top of `from`, committed (one commit per message); HEAD comes back to `main`. */
  const shadow = async (
    id: string,
    from: string,
    commits: Array<{ edit: () => void; message: string; body?: string }>,
  ): Promise<string> => {
    const tmp = `tmp-shadow-${++n}`;
    await git(['checkout', '-q', '-b', tmp, from], dir);
    let tip = from;
    for (const c of commits) {
      c.edit();
      tip = await commitAll(c.message, c.body);
    }
    await git(['update-ref', `refs/runs/${id}`, tip], dir);
    await git(['checkout', '-q', 'main'], dir);
    await git(['branch', '-q', '-D', tmp], dir);
    return tip;
  };
  const rmFile = (rel: string): void => fs.rmSync(path.join(dir, rel));

  /** The repository as a value — the index bytes read first, status without optional locks. */
  const repoState = async (): Promise<{ head: string; symbolicHead: string; refs: string; index: string; worktree: Record<string, string | null>; status: string; mergeInProgress: boolean }> => {
    const index = fs.readFileSync(path.join(dir, '.git', 'index')).toString('base64');
    const read = (rel: string): string | null => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);
    return {
      index,
      head: (await git(['rev-parse', 'HEAD'], dir)).trim(),
      symbolicHead: (await git(['symbolic-ref', '-q', 'HEAD'], dir)).trim(),
      refs: await git(['for-each-ref', '--format=%(refname) %(objectname)'], dir),
      status: await git(['--no-optional-locks', 'status', '--porcelain'], dir),
      worktree: Object.fromEntries(
        ['pages/a.md', 'pages/b.md', 'pages/c.md', '.claude4spec/entities/endpoint/e2.json'].map((f) => [f, read(f)]),
      ),
      mergeInProgress: fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD')),
    };
  };

  const get = (ref?: string) => {
    const req = request(app).get('/api/shadow-diff');
    return ref === undefined ? req : req.query({ ref });
  };

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-shadow-diff-')));
    pagesDir = path.join(dir, 'pages');
    await git(['init', '-q', '-b', 'main'], dir);
    await git(['config', 'user.email', 'test@example.com'], dir);
    await git(['config', 'user.name', 'Test'], dir);
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: true } }, null, 2));

    db = new Database(':memory:');
    runMigrations(db);
    gitService = new GitService(dir, [pagesDir]);
    const releaseStore = new ReleaseFileStore(dir, '.claude4spec/releases', { suppress: () => {} } as SelfWriteSuppressor);
    releaseStore.ensureRoot();
    releaseService = new ReleaseService(
      db,
      host,
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
    releaseService.setReleaseFlagRootDirs([pagesDir, path.join(dir, '.claude4spec', 'entities')]);
    releaseService.setEntityStore(
      new EntityStore(dir, '.claude4spec/entities', { suppress: () => {} } as SelfWriteSuppressor, {} as RawEntityReader, host),
    );

    app = express();
    app.use(express.json());
    app.use('/api/releases', releasesRouter(releaseService));
    app.use('/api/shadow-diff', shadowDiffRouter(releaseService));
    app.use(errorHandler);

    // The trial merge is available unless a test injects an older git.
    vi.spyOn(GitService.prototype as unknown as GitVersionHolder, 'gitVersion').mockResolvedValue('git version 2.38.0');

    // C1: the commit the shadows branch from.
    write('pages/a.md', 'A one');
    write('pages/b.md', 'B one');
    write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v1' }));
    write('.claude4spec/entities/endpoint/e2.json', entityFile({ summary: 'keep' }));
    write('.claude4spec/releases/v1.json', JSON.stringify({ name: 'v1' }) + '\n');
    c1 = await commitAll('C1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The base scenario: the shadow edits `a.md`, deletes `e2`, creates `e3`; the master then edits `b.md` (C2, HEAD). */
  const baseScenario = async (): Promise<string> => {
    const tip = await shadow('run-1/spec', c1, [
      {
        edit: () => {
          write('pages/a.md', 'A shadow');
          rmFile('.claude4spec/entities/endpoint/e2.json');
          write('.claude4spec/entities/endpoint/e3.json', entityFile({ summary: 'fresh' }));
        },
        message: 'Shadow turn',
      },
    ]);
    write('pages/b.md', 'B master');
    c2 = await commitAll('C2');
    return tip;
  };

  /** The conflict scenario: like the base one, but the master also edits `a.md` — the trial merge conflicts. */
  const conflictScenario = async (): Promise<string> => {
    const tip = await shadow('run-1/spec', c1, [
      {
        edit: () => {
          write('pages/a.md', 'A shadow');
          rmFile('.claude4spec/entities/endpoint/e2.json');
          write('.claude4spec/entities/endpoint/e3.json', entityFile({ summary: 'fresh' }));
        },
        message: 'Shadow turn',
      },
    ]);
    write('pages/a.md', 'A master');
    write('pages/b.md', 'B master');
    c2 = await commitAll('C2');
    return tip;
  };

  const ops = (body: ShadowDiffResponse) => ({
    entities: body.entities.map((e) => `${e.type}/${e.slug}:${e.op}`).sort(),
    pages: body.pages.map((p) => `${p.rootId}/${p.path}:${p.op}`).sort(),
  });

  const addedLines = (body: ShadowDiffResponse, page: string): string[] =>
    (body.pages.find((p) => p.path === page)?.modified_sections ?? []).flatMap((s) =>
      s.line_diff.lines.filter((l) => l.op === 'added').map((l) => l.content),
    );

  // ── endpoint + DTO ────────────────────────────────────────────────────────

  it('[entity:get-api-shadow-diff] GET /api/shadow-diff?ref=<id> answers 200 with ShadowDiffResponse; no ref → 400 VALIDATION; git off → 400 GIT_UNAVAILABLE; unknown ref → 404 SHADOW_NOT_FOUND', async () => {
    const tip = await baseScenario();

    const ok = await get('run-1/spec');
    expect(ok.status).toBe(200);
    expect(ok.body.shadow).toEqual({ id: 'run-1/spec', tipSha: tip });

    // The id contains `/`: it travels percent-encoded in the query, never in a path segment.
    const encoded = await request(app).get(`/api/shadow-diff?ref=${encodeURIComponent('run-1/spec')}`);
    expect(encoded.status).toBe(200);
    expect(encoded.body.shadow.id).toBe('run-1/spec');

    for (const bad of [await get(), await get(''), await request(app).get('/api/shadow-diff?ref=a&ref=b')]) {
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION');
    }

    const unknown = await get('no-such-shadow');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('SHADOW_NOT_FOUND');

    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2));
    const off = await get('run-1/spec');
    expect(off.status).toBe(400);
    expect(off.body.error.code).toBe('GIT_UNAVAILABLE');
  });

  it('[entity:shadow-diff-response] the payload carries every required field with its type — mode, shadow, head, base, masterAhead, conflicts, mergePreview, outsideSpecFiles, touchesReleases, commits, entities, pages, before — and nothing else', async () => {
    const tip = await baseScenario();
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    const body = res.body as ShadowDiffResponse;

    expect(Object.keys(body).sort()).toEqual(
      ['base', 'before', 'commits', 'conflicts', 'entities', 'head', 'masterAhead', 'mergePreview', 'mode', 'outsideSpecFiles', 'pages', 'shadow', 'touchesReleases'].sort(),
    );
    expect(['merge', 'shadow-only']).toContain(body.mode);
    expect(body.shadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    expect(body.head).toEqual({ sha: c2 });
    expect(body.base).toEqual({ sha: c1 });
    expect(typeof body.masterAhead).toBe('number');
    expect(Array.isArray(body.conflicts) && body.conflicts.every((p) => typeof p === 'string')).toBe(true);
    expect(typeof body.mergePreview).toBe('boolean');
    expect(Array.isArray(body.outsideSpecFiles) && body.outsideSpecFiles.every((p) => typeof p === 'string')).toBe(true);
    expect(typeof body.touchesReleases).toBe('boolean');
    expect(body.commits.length).toBeGreaterThan(0);
    for (const c of body.commits) {
      expect(Object.keys(c).sort()).toEqual(['body', 'sha', 'subject']);
      expect([typeof c.sha, typeof c.subject, typeof c.body]).toEqual(['string', 'string', 'string']);
    }
    // `entities` / `pages` in the shape of RawDelta's fields of those names.
    for (const e of body.entities) {
      expect(typeof e.type).toBe('string');
      expect(typeof e.slug).toBe('string');
      expect(['created', 'deleted', 'updated']).toContain(e.op);
      expect(Array.isArray(e.changes)).toBe(true);
    }
    for (const p of body.pages) {
      expect(Object.keys(p).sort()).toEqual(
        ['added_sections', 'frontmatter_diff', 'modified_sections', 'moved_sections', 'op', 'path', 'removed_sections', 'rootId', 'xml_refs_diff'].sort(),
      );
    }
    // `before`: type → slug → payload object.
    expect(typeof body.before).toBe('object');
    for (const bySlug of Object.values(body.before)) {
      for (const payload of Object.values(bySlug)) expect(payload !== null && typeof payload === 'object').toBe(true);
    }
    // No release pair: the response carries SHAs, not `from`/`to`.
    expect(body).not.toHaveProperty('from');
    expect(body).not.toHaveProperty('to');
  });

  // ── modes ─────────────────────────────────────────────────────────────────

  it('[ac:ac-bez-konfliktu-get-api-shadow-diff-zwr] without a conflict GET /api/shadow-diff answers mode: merge', async () => {
    await baseScenario();
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('merge');
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.mergePreview).toBe(true);
  });

  it('[ac:ac-przy-konflikcie-get-api-shadow-diff-z] on a conflict GET /api/shadow-diff answers mode: shadow-only', async () => {
    await conflictScenario();
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('shadow-only');
    expect(res.body.mergePreview).toBe(true);
  });

  it('[ac:ac-przy-konflikcie-get-api-shadow-diff-z-2] on a conflict GET /api/shadow-diff answers a non-empty conflicts list', async () => {
    await conflictScenario();
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.conflicts.length).toBeGreaterThan(0);
    expect(res.body.conflicts).toEqual(['pages/a.md']);
  });

  it('[ac:ac-w-trybie-merge-delta-get-api-shadow-d] in merge mode the delta of GET /api/shadow-diff is the difference HEAD → trial-merge result', async () => {
    const tip = await baseScenario();
    const diffRefs = vi.spyOn(gitService, 'diffRefs');
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('merge');

    // The trial merge's result tree, computed by git itself.
    const tree = (await git(['merge-tree', '--write-tree', c2, tip], dir)).trim().split('\n')[0]!;
    // The core ran on HEAD → result tree (the other diffRefs call is the flags' merge-base..tip).
    expect(diffRefs.mock.calls.map((c) => [c[0], c[1]])).toContainEqual([c2, tree]);
    // …and its delta is exactly what HEAD → result contains: what the shadow brings, nothing of the master.
    const changed = (await git(['diff', '--no-renames', '--name-status', c2, tree], dir)).trim().split('\n').sort();
    expect(changed).toEqual(['A\t.claude4spec/entities/endpoint/e3.json', 'D\t.claude4spec/entities/endpoint/e2.json', 'M\tpages/a.md']);
    expect(ops(res.body)).toEqual({
      entities: ['endpoint/e2:deleted', 'endpoint/e3:created'],
      pages: ['pages/a.md:modified'],
    });
    expect(addedLines(res.body, 'a.md')).toEqual(['A shadow']);
  });

  it('[ac:ac-w-trybie-merge-zmiana-mastera-zrobion] in merge mode a master change made after the shadow branched does not appear in the delta of GET /api/shadow-diff', async () => {
    await baseScenario(); // C2 (after the branch point) edits b.md on the master
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('merge');
    expect(res.body.pages.map((p: { path: string }) => p.path)).not.toContain('b.md');
    expect(res.body.masterAhead).toBe(1);
  });

  it('[ac:ac-niezacommitowana-zmiana-mastera-nie-p] an uncommitted master change does not appear in the delta of GET /api/shadow-diff', async () => {
    await baseScenario();
    write('pages/b.md', 'B uncommitted');
    write('pages/c.md', 'C staged');
    await git(['add', 'pages/c.md'], dir);
    write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v1 uncommitted' }));

    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(ops(res.body)).toEqual({
      entities: ['endpoint/e2:deleted', 'endpoint/e3:created'],
      pages: ['pages/a.md:modified'],
    });
  });

  it('[ac:ac-przy-gicie-starszym-niz-2-38-get-api] with git older than 2.38 GET /api/shadow-diff answers mergePreview: false', async () => {
    await baseScenario(); // would merge cleanly — the old git cannot try
    vi.spyOn(GitService.prototype as unknown as GitVersionHolder, 'gitVersion').mockResolvedValue('git version 2.37.1');
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mergePreview).toBe(false);
    expect(res.body.mode).toBe('shadow-only');
    expect(res.body.conflicts).toEqual([]);
    // shadow-only: merge-base..tip — what the shadow did.
    expect(ops(res.body)).toEqual({
      entities: ['endpoint/e2:deleted', 'endpoint/e3:created'],
      pages: ['pages/a.md:modified'],
    });
  });

  // ── refusals ──────────────────────────────────────────────────────────────

  it('[ac:ac-get-api-shadow-diff-z-nieznanym-ref-z] GET /api/shadow-diff with an unknown ref answers 404 SHADOW_NOT_FOUND', async () => {
    await baseScenario();
    for (const ref of ['missing', 'run-1', 'run-1/spec~1', 'heads/main']) {
      const res = await get(ref);
      expect(res.status, ref).toBe(404);
      expect(res.body.error.code, ref).toBe('SHADOW_NOT_FOUND');
    }
  });

  it('[ac:ac-get-api-shadow-diff-z-refem-bedacym-p] GET /api/shadow-diff with a ref that is an ancestor of HEAD answers 404 SHADOW_NOT_FOUND', async () => {
    await baseScenario();
    await git(['update-ref', 'refs/runs/accepted', c1], dir);
    const res = await get('accepted');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SHADOW_NOT_FOUND');
  });

  it('[ac:ac-przy-git-off-get-api-shadow-diff-zwra] with git off GET /api/shadow-diff answers 400 GIT_UNAVAILABLE', async () => {
    await baseScenario();
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2));
    const res = await get('run-1/spec');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GIT_UNAVAILABLE');
  });

  it('[section:22u3o5bx] SHADOW_NOT_FOUND (404) refuses an id with no ref, a ref with no common ancestor with HEAD and a ref already contained in HEAD; GIT_UNAVAILABLE (400) refuses git off and a missing repository — never an empty delta, never the SQLite track', async () => {
    await baseScenario();
    // No common ancestor with HEAD: an orphan commit under refs/runs/.
    await git(['checkout', '-q', '--orphan', 'lonely'], dir);
    await git(['rm', '-q', '-rf', '--cached', '.'], dir);
    write('lonely.md', 'lonely');
    await git(['add', 'lonely.md'], dir);
    await git(['commit', '-q', '-m', 'lonely root'], dir);
    await git(['update-ref', 'refs/runs/unrelated', (await git(['rev-parse', 'HEAD'], dir)).trim()], dir);
    rmFile('lonely.md');
    await git(['checkout', '-q', '-f', 'main'], dir);
    await git(['branch', '-q', '-D', 'lonely'], dir);
    await git(['update-ref', 'refs/runs/accepted', c1], dir);

    for (const ref of ['missing', 'unrelated', 'accepted']) {
      const res = await get(ref);
      expect(res.status, ref).toBe(404);
      expect(res.body.error.code, ref).toBe('SHADOW_NOT_FOUND');
    }

    // A release in SQLite changes nothing: the comparison never falls back to it.
    db.prepare(`INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1', 'v1', 'v1', 'user', '2026-01-01T00:00:00.000Z')`).run();
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2));
    const off = await get('run-1/spec');
    expect(off.status).toBe(400);
    expect(off.body.error.code).toBe('GIT_UNAVAILABLE');
    expect(off.body).not.toHaveProperty('entities');

    // Git on, but no repository around the page roots.
    const noRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-shadow-norepo-')));
    try {
      fs.mkdirSync(path.join(noRepo, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(noRepo, '.claude4spec', 'config.json'), JSON.stringify({ $schemaVersion: 4, name: 't', git: { enabled: true } }));
      fs.mkdirSync(path.join(noRepo, 'pages'));
      const svc = new ReleaseService(db, host, {} as VersionService, {} as FileVersionService, pageSerializer, {} as RawEntityReader, {} as TagsService, {} as PagesService, () => null, noRepo, ['pages'], [path.join(noRepo, 'pages')]);
      svc.setReleaseStore(new ReleaseFileStore(noRepo, '.claude4spec/releases', { suppress: () => {} } as SelfWriteSuppressor));
      svc.setGitService(new GitService(noRepo, [path.join(noRepo, 'pages')]));
      await expect(svc.shadowDiff('run-1/spec')).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' });
    } finally {
      fs.rmSync(noRepo, { recursive: true, force: true });
    }
  });

  it('[review:rev-0001] [section:22u3o5bx] a missing release store is a wiring fault (500), not GIT_UNAVAILABLE — git off and no git service still answer GIT_UNAVAILABLE', async () => {
    await baseScenario();
    const unwired = (withGit: boolean): ReleaseService => {
      const svc = new ReleaseService(db, host, {} as VersionService, {} as FileVersionService, pageSerializer, {} as RawEntityReader, {} as TagsService, {} as PagesService, () => null, dir, ['pages'], [pagesDir]);
      if (withGit) svc.setGitService(gitService);
      svc.setReleaseFlagRootDirs([pagesDir, path.join(dir, '.claude4spec', 'entities')]);
      return svc;
    };
    const route = (svc: ReleaseService) => {
      const a = express();
      a.use('/api/shadow-diff', shadowDiffRouter(svc));
      a.use(errorHandler);
      return (ref: string) => request(a).get('/api/shadow-diff').query({ ref });
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Git wired and a repository present, only the store missing: a server fault, the cause named truthfully.
    await expect(unwired(true).shadowDiff('run-1/spec')).rejects.toThrow(/release store is not wired/);
    const fault = await route(unwired(true))('run-1/spec');
    expect(fault.status).toBe(500);
    expect(fault.body.error?.code).not.toBe('GIT_UNAVAILABLE');
    expect(fault.body).not.toHaveProperty('mode');

    // No git service at all: still the refusal.
    const noGit = await route(unwired(false))('run-1/spec');
    expect(noGit.status).toBe(400);
    expect(noGit.body.error.code).toBe('GIT_UNAVAILABLE');

    // Git off with the store missing: the refusal, not the wiring fault.
    write('.claude4spec/config.json', JSON.stringify({ $schemaVersion: 4, name: 'test', git: { enabled: false } }, null, 2));
    const off = await route(unwired(true))('run-1/spec');
    expect(off.status).toBe(400);
    expect(off.body.error.code).toBe('GIT_UNAVAILABLE');
    errors.mockRestore();
  });

  it('ASSUMPTION:dev-4601 — a trial merge that fails on a supported git is a server fault (500), not a fall to shadow-only', async () => {
    await baseScenario();
    vi.spyOn(gitService, 'mergeTree').mockResolvedValue({ status: 'error' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('run-1/spec');
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('mode');
    errors.mockRestore();
  });

  // ── read-only ─────────────────────────────────────────────────────────────

  /** Both modes, with a dirty working tree and a staged file present. */
  const readOnlyRun = async (scenario: () => Promise<string>): Promise<{ before: Awaited<ReturnType<typeof repoState>>; after: Awaited<ReturnType<typeof repoState>>; mode: string }> => {
    await scenario();
    write('pages/b.md', 'B dirty');
    write('pages/c.md', 'C staged');
    await git(['add', 'pages/c.md'], dir);
    const before = await repoState();
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    return { before, after: await repoState(), mode: res.body.mode };
  };

  it('[ac:ac-probne-scalenie-nie-zmienia-head] the trial merge does not change HEAD', async () => {
    for (const scenario of [baseScenario, conflictScenario]) {
      if (scenario === conflictScenario) {
        // Fresh start for the second scenario: drop the first shadow and its master commit.
        await git(['reset', '-q', '--hard', c1], dir);
        await git(['update-ref', '-d', 'refs/runs/run-1/spec'], dir);
      }
      const { before, after, mode } = await readOnlyRun(scenario);
      expect(mode).toBe(scenario === baseScenario ? 'merge' : 'shadow-only');
      expect(after.head).toBe(before.head);
      expect(after.symbolicHead).toBe('refs/heads/main');
      expect(after.symbolicHead).toBe(before.symbolicHead);
      expect(after.refs).toBe(before.refs);
      expect(after.mergeInProgress).toBe(false);
    }
  });

  it('[ac:ac-probne-scalenie-nie-zmienia-indeksu] the trial merge does not change the index', async () => {
    for (const scenario of [baseScenario, conflictScenario]) {
      if (scenario === conflictScenario) {
        await git(['reset', '-q', '--hard', c1], dir);
        await git(['update-ref', '-d', 'refs/runs/run-1/spec'], dir);
      }
      const { before, after } = await readOnlyRun(scenario);
      expect(after.index).toBe(before.index);
      expect(after.status).toBe(before.status);
      expect(after.status).toContain('A  pages/c.md');
    }
  });

  it('[ac:ac-probne-scalenie-nie-zmienia-drzewa-ro] the trial merge does not change the working tree', async () => {
    for (const scenario of [baseScenario, conflictScenario]) {
      if (scenario === conflictScenario) {
        await git(['reset', '-q', '--hard', c1], dir);
        await git(['update-ref', '-d', 'refs/runs/run-1/spec'], dir);
      }
      const { before, after } = await readOnlyRun(scenario);
      expect(after.worktree).toEqual(before.worktree);
      // No conflict markers, no shadow content on disk.
      expect(after.worktree['pages/a.md']).not.toContain('<<<<<<<');
      expect(after.worktree['pages/a.md']).not.toBe('A shadow');
      expect(after.worktree['pages/b.md']).toBe('B dirty');
    }
  });

  // ── sections ──────────────────────────────────────────────────────────────

  it('[section:jssreefn] the comparison is computed from git alone, by the two-state core, in the mode the trial merge decides — no SQLite read, no repository lock', async () => {
    const tip = await baseScenario();
    const prepare = vi.spyOn(db, 'prepare');
    const run = vi.spyOn(GitRepoLock.prototype, 'run');
    const tryRun = vi.spyOn(GitRepoLock.prototype, 'tryRun');
    const mergeTree = vi.spyOn(gitService, 'mergeTree');

    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(mergeTree).toHaveBeenCalledTimes(1);
    expect(mergeTree.mock.calls[0]!.slice(0, 2)).toEqual([c2, tip]);
    expect(res.body.mode).toBe('merge');
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(tryRun).not.toHaveBeenCalled();
  });

  it('[section:pu2g4dms] merge mode: the delta is the core on HEAD → result tree — what changes on the master once accepted; master changes after the branch point are no revert; uncommitted changes stay out', async () => {
    const tip = await baseScenario();
    write('pages/b.md', 'B uncommitted');
    const showFile = vi.spyOn(gitService, 'showFile');
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('merge');
    const tree = (await git(['merge-tree', '--write-tree', c2, tip], dir)).trim().split('\n')[0]!;
    // Every file read of the delta is at HEAD or at the result tree.
    expect(new Set(showFile.mock.calls.map((c) => c[0]))).toEqual(new Set([c2, tree]));
    expect(ops(res.body).pages).toEqual(['pages/a.md:modified']);
    // The master's b.md change (C2) is in the result tree, so it never shows as a revert to 'B one'.
    expect(res.body.pages.find((p: { path: string }) => p.path === 'b.md')).toBeUndefined();
  });

  it('[section:ce8plh8i] shadow-only on a conflict (or an old git): the delta is the core on merge-base..tip plus the conflicted files; the conflicted tree is never read', async () => {
    const tip = await conflictScenario();
    const showFile = vi.spyOn(gitService, 'showFile');
    const diffRefs = vi.spyOn(gitService, 'diffRefs');
    const res = await get('run-1/spec');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('shadow-only');
    expect(res.body.conflicts).toEqual(['pages/a.md']);
    // merge-base..tip only: no read of HEAD, of a tree, or of anything else.
    expect(new Set(showFile.mock.calls.map((c) => c[0]))).toEqual(new Set([c1, tip]));
    for (const call of diffRefs.mock.calls) expect([call[0], call[1]]).toEqual([c1, tip]);
    // "What the shadow did": a.md as the shadow wrote it, never the conflict markers.
    expect(addedLines(res.body, 'a.md')).toEqual(['A shadow']);
    expect(JSON.stringify(res.body.pages)).not.toContain('<<<<<<<');
    expect(ops(res.body)).toEqual({
      entities: ['endpoint/e2:deleted', 'endpoint/e3:created'],
      pages: ['pages/a.md:modified'],
    });
  });

  it('[section:0xvhubti] the left side of the delta is the source of the deleted entities\' "before" — HEAD in merge mode, the base in shadow-only; the header is base @ sha → shadow @ sha plus master +N commits since the base', async () => {
    const tip = await baseScenario();
    const merge = (await get('run-1/spec')).body as ShadowDiffResponse;
    expect(merge.mode).toBe('merge');
    expect(merge.before).toEqual({ endpoint: { e2: { summary: 'keep' } } });
    const atHead = JSON.parse(await git(['show', `${c2}:.claude4spec/entities/endpoint/e2.json`], dir)) as Record<string, unknown>;
    expect(atHead.summary).toBe(merge.before.endpoint!.e2!.summary);
    // The payload, not the file envelope.
    expect(merge.before.endpoint!.e2).not.toHaveProperty('createdAt');
    expect(merge.before.endpoint!.e2).not.toHaveProperty('payloadVersion');
    expect(merge.base).toEqual({ sha: c1 });
    expect(merge.shadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    expect(merge.masterAhead).toBe(1);

    // shadow-only: the master edits e2 after the branch point too → a modify/delete conflict; "before" is the BASE's e2.
    await git(['reset', '-q', '--hard', c1], dir);
    await git(['update-ref', '-d', 'refs/runs/run-1/spec'], dir);
    const tip2 = await shadow('run-1/spec', c1, [{ edit: () => rmFile('.claude4spec/entities/endpoint/e2.json'), message: 'Delete e2' }]);
    write('.claude4spec/entities/endpoint/e2.json', entityFile({ summary: 'keep (master)' }));
    await commitAll('C2b');
    write('pages/b.md', 'B again');
    const c3 = await commitAll('C3');
    const only = (await get('run-1/spec')).body as ShadowDiffResponse;
    expect(only.mode).toBe('shadow-only');
    expect(only.conflicts).toEqual(['.claude4spec/entities/endpoint/e2.json']);
    expect(only.before).toEqual({ endpoint: { e2: { summary: 'keep' } } });
    expect(only.head).toEqual({ sha: c3 });
    expect(only.base).toEqual({ sha: c1 });
    expect(only.shadow.tipSha).toBe(tip2);
    expect(only.masterAhead).toBe(2);
  });

  it('[section:nemiv2qh] the acceptance flags are computed on merge-base..tip in both modes — outsideSpecFiles, touchesReleases, conflicts, commits — and the result carries the tip and HEAD SHAs', async () => {
    const tip = await shadow('run-1/spec', c1, [
      { edit: () => write('pages/a.md', 'A shadow'), message: 'Edit a' },
      {
        edit: () => {
          write('other/x.txt', 'outside');
          write('README.md', 'readme');
          write('.claude4spec/releases/v9.json', JSON.stringify({ name: 'v9' }) + '\n');
          write('.claude4spec/entities/endpoint/e1.json', entityFile({ summary: 'v1 shadow' }));
        },
        message: 'Edit the rest',
        body: 'Second paragraph of the message.',
      },
    ]);
    const first = (await git(['rev-parse', `${tip}~1`], dir)).trim();
    // A master commit outside the spec after the branch point: not the shadow's, so no flag.
    write('master-only.txt', 'master');
    c2 = await commitAll('C2');

    for (const version of ['git version 2.38.0', 'git version 2.37.1']) {
      vi.spyOn(GitService.prototype as unknown as GitVersionHolder, 'gitVersion').mockResolvedValue(version);
      const body = (await get('run-1/spec')).body as ShadowDiffResponse;
      expect(body.mode, version).toBe(version.endsWith('2.38.0') ? 'merge' : 'shadow-only');
      expect(body.outsideSpecFiles, version).toEqual(['README.md', 'other/x.txt']);
      expect(body.touchesReleases, version).toBe(true);
      expect(body.conflicts, version).toEqual([]);
      expect(body.commits, version).toEqual([
        { sha: tip, subject: 'Edit the rest', body: 'Second paragraph of the message.' },
        { sha: first, subject: 'Edit a', body: '' },
      ]);
      expect(body.shadow.tipSha, version).toBe(tip);
      expect(body.head.sha, version).toBe(c2);
      // The release file is never delta content.
      expect(body.pages.map((p) => p.path), version).not.toContain('v9.json');
    }

    // A shadow that leaves the releases root and everything outside the registry alone.
    const clean = await shadow('run-2/spec', c1, [{ edit: () => write('pages/a.md', 'A two'), message: 'Only a' }]);
    const body = (await get('run-2/spec')).body as ShadowDiffResponse;
    expect(body.touchesReleases).toBe(false);
    expect(body.outsideSpecFiles).toEqual([]);
    expect(body.commits).toEqual([{ sha: clean, subject: 'Only a', body: '' }]);
  });

  it('[section:856sq0nw] the result is not reproducible: it moves with HEAD and with a rewrite of the shadow, and says on which SHAs it was computed', async () => {
    const tip = await baseScenario();
    const one = (await get('run-1/spec')).body as ShadowDiffResponse;
    expect([one.head.sha, one.shadow.tipSha, one.masterAhead]).toEqual([c2, tip, 1]);

    write('pages/b.md', 'B later');
    const c3 = await commitAll('C3');
    const two = (await get('run-1/spec')).body as ShadowDiffResponse;
    expect([two.head.sha, two.shadow.tipSha, two.masterAhead]).toEqual([c3, tip, 2]);

    // The shadow is rewritten (a forced fetch moves the ref).
    const rewritten = await shadow('run-1/spec', c1, [{ edit: () => write('pages/a.md', 'A rewritten'), message: 'Rewrite' }]);
    const three = (await get('run-1/spec')).body as ShadowDiffResponse;
    expect(three.shadow.tipSha).toBe(rewritten);
    expect(addedLines(three, 'a.md')).toEqual(['A rewritten']);
    expect(ops(three).entities).toEqual([]);
  });

  it('[section:m17api001] releaseService.shadowDiff(ref) is the public M17 entry — the git track only: with no git service it refuses GIT_UNAVAILABLE instead of reading SQLite', async () => {
    const tip = await baseScenario();
    const direct = await releaseService.shadowDiff('run-1/spec');
    expect(direct.shadow).toEqual({ id: 'run-1/spec', tipSha: tip });
    expect(direct.mode).toBe('merge');

    const bare = new ReleaseService(db, host, {} as VersionService, {} as FileVersionService, pageSerializer, {} as RawEntityReader, {} as TagsService, {} as PagesService, () => null, dir, ['pages'], [pagesDir]);
    const prepare = vi.spyOn(db, 'prepare');
    await expect(bare.shadowDiff('run-1/spec')).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' });
    await expect(bare.shadowDiff(undefined)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('[section:xkpt256d] the same structural difference shows what changes in the specification once a not-yet-accepted version is accepted — section- and field-level, not text', async () => {
    await baseScenario();
    const body = (await get('run-1/spec')).body as ShadowDiffResponse;
    const a = body.pages.find((p) => p.path === 'a.md')!;
    expect(a.rootId).toBe('pages');
    expect(a.modified_sections).toHaveLength(1);
    expect(a.modified_sections[0]!.line_diff.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'removed', content: 'A one' }),
        expect.objectContaining({ op: 'added', content: 'A shadow' }),
      ]),
    );
    const e3 = body.entities.find((e) => e.slug === 'e3')!;
    expect(e3.op).toBe('created');
  });

  it('[section:m17api401] mounting: M17 has two own routers — /api/releases for releases and /api/shadow-diff for the shadow comparison; /api/releases/shadow-diff is a release name, not this route', async () => {
    await baseScenario();
    expect((await get('run-1/spec')).status).toBe(200);
    const underReleases = await request(app).get('/api/releases/shadow-diff').query({ ref: 'run-1/spec' });
    expect(underReleases.status).toBe(404);
    expect(underReleases.body.error.code).toBe('RELEASE_NOT_FOUND');
    // The router is mounted in the project context under its own prefix.
    const ctx = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../workspace/project-context.ts'), 'utf8');
    expect(ctx).toMatch(/router\.use\('\/shadow-diff', shadowDiffRouter\(releaseService\)\)/);
    expect(ctx).toMatch(/router\.use\('\/releases', releasesRouter\(/);
  });
});
