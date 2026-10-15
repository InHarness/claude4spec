/**
 * 2.1.10 (M25 wosnh845 step 6/8, M28 sw1u84nn) — `POST /api/release-pushes`
 * carries the best-effort git push outcome in `gitSync`; a push the remote
 * rejected as non-fast-forward is its own recovery kind, any other push
 * failure keeps the plain `recovery` (no `kind`).
 *
 * Real `GitService` against real repositories (a bare "origin" and a second
 * clone that pushes first); the remote spec server (M24) and the bundle build
 * (M17) are fakes — the git outcome is what this suite is about.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { GitService } from '../services/git.js';
import { ReleasePushService } from '../services/release-push.js';
import { releasePushesRouter } from './release-pushes.js';
import { errorHandler } from './errors.js';
import { DomainError } from '../services/tags.js';
import type { ReleaseService } from '../services/release.js';
import type { RemoteAuthService } from '../services/remote-auth.js';
import type { ReleasePushResponse } from '../../shared/release-push.js';

const pexec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd });
  return stdout;
}

async function identity(dir: string): Promise<void> {
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

async function commitFile(dir: string, file: string, content: string, msg: string): Promise<void> {
  fs.writeFileSync(path.join(dir, file), content);
  await git(['add', '.'], dir);
  await git(['commit', '-m', msg], dir);
}

let tmp: string;
let dir: string; // the project's repository (page root `.`)
let bare: string; // origin
let other: string; // another clone that pushes first
let db: Database.Database;
let app: express.Express;
let releaseId: number;
let releasesFake: ReleaseService;
let remoteAuthFake: RemoteAuthService;

/** An app over the same fakes, whose release resolves to `releaseFilePath` (the marker file). */
function appWithReleaseFile(releaseFilePath: string | null): express.Express {
  const releases = { ...releasesFake, getReleaseFilePath: () => releaseFilePath } as unknown as ReleaseService;
  const service = new ReleasePushService(db, releases, remoteAuthFake, new GitService(dir, [dir]), dir);
  return express().use(express.json()).use('/api/release-pushes', releasePushesRouter(service)).use(errorHandler);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-release-push-'));
  dir = path.join(tmp, 'project');
  bare = path.join(tmp, 'origin.git');
  other = path.join(tmp, 'other');

  await pexec('git', ['init', '--bare', '-b', 'main', bare]);
  fs.mkdirSync(dir);
  await git(['init', '-b', 'main'], dir);
  await identity(dir);
  fs.mkdirSync(path.join(dir, '.claude4spec'));
  fs.writeFileSync(
    path.join(dir, '.claude4spec', 'config.json'),
    JSON.stringify(
      {
        $schemaVersion: 4,
        name: 'test',
        remoteProjectId: '11111111-2222-3333-4444-555555555555',
        roots: [{ id: 'pages', name: 'Pages', dir: '.', builtin: true }],
        git: { enabled: true, syncPushOnPush: true },
      },
      null,
      2,
    ),
  );
  await commitFile(dir, 'seed.md', 'seed', 'seed');
  await git(['remote', 'add', 'origin', bare], dir);
  await git(['push', '-u', 'origin', 'main'], dir);

  db = new Database(':memory:');
  runMigrations(db);
  releaseId = Number(
    db
      .prepare(`INSERT INTO spec_release (name, description, created_by, created_at) VALUES (?, ?, 'user', ?)`)
      .run('v1', 'first', '2026-10-09T12:00:00.000Z').lastInsertRowid,
  );

  const bundlePath = () => {
    const p = path.join(tmp, `bundle-${Date.now()}-${Math.random()}.tar.gz`);
    fs.writeFileSync(p, 'bundle');
    return p;
  };
  const releases = {
    // 2.1.11: the push resolves the release by NAME; only `v1` exists here —
    // plus a release carrying the reserved name `current` (2.1.23), which the
    // push must refuse before it ever reaches this lookup.
    resolveReleaseId: (name: string) => {
      if (name === 'current') return releaseId;
      if (name !== 'v1') throw new DomainError('RELEASE_NOT_FOUND', `release '${name}' not found`);
      return releaseId;
    },
    buildBundleArchive: async () => ({
      tarGzPath: bundlePath(),
      sizeBytes: 6,
      sha256: 'a'.repeat(64),
      bundleSchemaVersion: 1,
    }),
    // No release marker file → the push falls back to the current branch.
    getReleaseFilePath: () => null,
  } as unknown as ReleaseService;
  const remoteAuth = {
    getCurrentAccount: () => ({
      connected: true,
      accountStatus: 'active',
      remoteAccountId: '8c1c2f04-7e21-4f3e-9a1d-2b3c4d5e6f70',
      accountEmail: 'user@example.com',
    }),
    pushBundle: async () => ({
      remoteProjectId: '11111111-2222-3333-4444-555555555555',
      remoteReleaseId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
      remoteReleaseSequence: 2,
      deduplicated: false,
    }),
  } as unknown as RemoteAuthService;

  releasesFake = releases;
  remoteAuthFake = remoteAuth;
  const gitService = new GitService(dir, [dir]);
  const service = new ReleasePushService(db, releases, remoteAuth, gitService, dir);
  app = express().use(express.json()).use('/api/release-pushes', releasePushesRouter(service)).use(errorHandler);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Another clone pushes a commit the project's repository does not have. */
async function remoteMovesAhead(): Promise<void> {
  await pexec('git', ['clone', bare, other]);
  await identity(other);
  await commitFile(other, 'theirs.md', 'theirs', 'their change');
  await git(['push', 'origin', 'main'], other);
}

describe('POST /api/release-pushes — gitSync of the git push hook (M25 + M28)', () => {
  it('[ac:ac-push-wydania-odrzucony-przez-remote-j] [entity:release-push-response] a push the remote rejects as non-fast-forward returns gitSync.status "error" with recovery.kind "non-fast-forward"', async () => {
    await remoteMovesAhead();
    await commitFile(dir, 'mine.md', 'mine', 'my change');

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    const body = res.body as ReleasePushResponse;
    // The remote (spec server) push itself succeeded — the DTO's own fields.
    expect(body).toMatchObject({
      releaseId,
      release: { id: releaseId, name: 'v1' },
      status: 'success',
      deduplicated: false,
      remoteReleaseSequence: 2,
      contentSha256: 'a'.repeat(64),
      bundleSchemaVersion: 1,
    });
    // The git push was rejected: its own recovery kind, operation stays `push`.
    expect(body.gitSync?.status).toBe('error');
    expect(body.gitSync?.recovery?.operation).toBe('push');
    expect(body.gitSync?.recovery?.kind).toBe('non-fast-forward');
    expect(body.gitSync?.recovery?.gitStderr).toMatch(/rejected/);
    expect(body.gitSync?.recovery?.intentPrompt).toBeTruthy();
  });

  it('[entity:release-push-response] the same holds once the remote commits are fetched (git reports "non-fast-forward" instead of "fetch first")', async () => {
    await remoteMovesAhead();
    await commitFile(dir, 'mine.md', 'mine', 'my change');
    await git(['fetch', 'origin'], dir);

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.gitSync?.status).toBe('error');
    expect(res.body.gitSync?.recovery?.kind).toBe('non-fast-forward');
  });

  it('[entity:release-push-response] any other push failure keeps the plain recovery — no kind', async () => {
    // The origin is gone: a push failure that is not a non-fast-forward rejection.
    fs.rmSync(bare, { recursive: true, force: true });
    await commitFile(dir, 'mine.md', 'mine', 'my change');

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.gitSync?.status).toBe('error');
    expect(res.body.gitSync?.recovery?.operation).toBe('push');
    expect(res.body.gitSync?.recovery?.kind).toBeUndefined();
  });

  it('[ac:ac-push-bez-upstream-przy-bledzie-sie] push() without upstream / on a network error / on non-fast-forward → gitSync { status: error, message }, while the release push itself stays recorded as success', async () => {
    const expectGitErrorButPushSucceeded = async (): Promise<void> => {
      const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.remoteReleaseId).toBe('99999999-aaaa-bbbb-cccc-dddddddddddd');
      expect(res.body.gitSync?.status).toBe('error');
      expect(typeof res.body.gitSync?.message).toBe('string');
      expect(res.body.gitSync?.message).not.toBe('');
    };

    // (a) the current branch has no upstream (pin the push config against ambient global settings).
    await git(['config', 'push.autoSetupRemote', 'false'], dir);
    await git(['config', 'push.default', 'simple'], dir);
    await git(['checkout', '-b', 'no-upstream'], dir);
    await commitFile(dir, 'mine.md', 'mine', 'my change');
    await expectGitErrorButPushSucceeded();
    await git(['checkout', 'main'], dir);

    // (b) non-fast-forward: the remote has commits the local branch lacks.
    await remoteMovesAhead();
    await commitFile(dir, 'mine-2.md', 'mine', 'my other change');
    await expectGitErrorButPushSucceeded();

    // (c) network error: the remote is gone.
    fs.rmSync(bare, { recursive: true, force: true });
    await expectGitErrorButPushSucceeded();

    // Every push attempt is in the audit log as a success.
    const log = await request(app).get('/api/release-pushes').query({ releaseName: 'v1' });
    expect(log.status).toBe(200);
    expect(log.body.items).toHaveLength(3);
    expect(log.body.items.every((p: ReleasePushResponse) => p.status === 'success')).toBe(true);
  });

  it('[ac:ac-gitservice-push-branch-pushuje-branch] pushOnPush pushes the branch carrying the release commit (git branch --contains resolveReleaseCommit), falling back to current HEAD when the commit is not found — not blindly HEAD', async () => {
    // The release marker file is committed on `release-target` only; HEAD stays on main.
    await git(['checkout', '-b', 'release-target'], dir);
    await commitFile(dir, 'v1.json', '{"name":"v1"}', 'v1\n\nfirst');
    const markerSha = (await git(['rev-parse', 'HEAD'], dir)).trim();
    await git(['checkout', 'main'], dir);
    // Local main moves ahead of its upstream too — a blind HEAD push would publish it.
    await commitFile(dir, 'local-main.md', 'main', 'main change');
    // As after a commit-target release with switchAfterRelease off: the release file stays on disk.
    fs.writeFileSync(path.join(dir, 'v1.json'), '{"name":"v1"}');
    const remoteMainBefore = (await git(['rev-parse', 'main'], bare)).trim();

    const res = await request(appWithReleaseFile(path.join(dir, 'v1.json'))).post('/api/release-pushes').send({ releaseName: 'v1' });
    expect(res.status).toBe(201);
    expect(res.body.gitSync).toMatchObject({ status: 'pushed', branch: 'release-target' });
    expect((await git(['rev-parse', 'release-target'], bare)).trim()).toBe(markerSha);
    // Current HEAD's branch was not what got pushed.
    expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(remoteMainBefore);

    // Fallback: the release file was never committed (no marker commit) → the current branch (HEAD) is pushed.
    fs.writeFileSync(path.join(dir, 'never-committed.json'), '{}');
    const fallback = await request(appWithReleaseFile(path.join(dir, 'never-committed.json')))
      .post('/api/release-pushes')
      .send({ releaseName: 'v1' });
    expect(fallback.body.gitSync).toMatchObject({ status: 'pushed', branch: 'main' });
    expect((await git(['rev-parse', 'main'], bare)).trim()).toBe((await git(['rev-parse', 'main'], dir)).trim());
  });

  it('[entity:release-push-response] a push the remote accepts returns gitSync.status "pushed" without recovery', async () => {
    await commitFile(dir, 'mine.md', 'mine', 'my change');

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.gitSync).toMatchObject({ status: 'pushed', branch: 'main' });
    expect(res.body.gitSync?.recovery).toBeUndefined();
  });

  /** Rewrite the project's `git` config block (read per call — hot-reload). */
  function setGitConfig(gitCfg: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(dir, '.claude4spec', 'config.json'),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'test',
        remoteProjectId: '11111111-2222-3333-4444-555555555555',
        roots: [{ id: 'pages', name: 'Pages', dir: '.', builtin: true }],
        git: gitCfg,
      }),
    );
  }

  it('[ac:ac-przy-config-git-syncpushonpush-false] [entity:release-push-response] with config.git.syncPushOnPush=false the release push answers gitSync: null and nothing is git-pushed', async () => {
    setGitConfig({ enabled: true, syncPushOnPush: false });
    await commitFile(dir, 'mine.md', 'mine', 'my change');
    const remoteMainBefore = (await git(['rev-parse', 'main'], bare)).trim();

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expectReleasePushPayload(res.body);
    expect(res.body.status).toBe('success'); // the remote push itself happened
    expect(res.body).toHaveProperty('gitSync', null);
    expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(remoteMainBefore);
  });

  it('[ac:ac-przy-w-czonym-config-git-syncpushonpush] with config.git.syncPushOnPush on and a detected repo, a successful release push git-pushes the current branch to its upstream; a failed remote push git-pushes nothing', async () => {
    await commitFile(dir, 'mine.md', 'mine', 'my change');
    const localHead = (await git(['rev-parse', 'main'], dir)).trim();
    expect((await git(['rev-parse', 'main'], bare)).trim()).not.toBe(localHead);

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.gitSync).toMatchObject({ status: 'pushed', branch: 'main' });
    // The upstream (origin/main in the bare remote) now carries the local branch tip.
    expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(localHead);

    // A remote push that fails does not trigger the git push.
    await commitFile(dir, 'mine-2.md', 'mine', 'my other change');
    const remoteBefore = (await git(['rev-parse', 'main'], bare)).trim();
    const failingRemote = {
      ...remoteAuthFake,
      pushBundle: async () => {
        throw new Error('peer unreachable');
      },
    } as unknown as RemoteAuthService;
    const failingApp = express()
      .use(express.json())
      .use('/api/release-pushes', releasePushesRouter(new ReleasePushService(db, releasesFake, failingRemote, new GitService(dir, [dir]), dir)))
      .use(errorHandler);
    const failed = await request(failingApp).post('/api/release-pushes').send({ releaseName: 'v1' });
    expect(failed.status).toBe(502);
    expect((await git(['rev-parse', 'main'], bare)).trim()).toBe(remoteBefore);
  });

  it('[ac:ac-wariant-error-gitcommitresult-gitpushres] a failed git push answers gitSync { status: error, message } plus the additive recovery { operation: push, reason, gitStderr, intentPrompt } on the release-push response', async () => {
    fs.rmSync(bare, { recursive: true, force: true }); // the push fails: origin is gone
    await commitFile(dir, 'mine.md', 'mine', 'my change');

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    // What an old consumer reads is intact: status + message …
    expect(res.body.status).toBe('success');
    expect(res.body.gitSync.status).toBe('error');
    expect(typeof res.body.gitSync.message).toBe('string');
    // … and the recovery payload rides alongside, composed by the backend.
    const recovery = res.body.gitSync.recovery;
    expect(recovery.operation).toBe('push');
    expect(typeof recovery.reason).toBe('string');
    expect(recovery.reason).not.toBe('');
    expect(typeof recovery.gitStderr).toBe('string');
    expect(recovery.gitStderr).not.toBe('');
    expect(typeof recovery.intentPrompt).toBe('string');
    expect(recovery.intentPrompt).toContain(recovery.gitStderr);
  });

  it('[ac:ac-wiersz-release-push-powsta-y-z-first-p] a first-push error row (config.remoteProjectId null) stores remote_project_id IS NULL — not \'\'; a subsequent-push error row stores the known remoteProjectId; the DTO leaves remoteProjectId undefined', async () => {
    const failingRemote = {
      ...remoteAuthFake,
      pushBundle: async () => {
        throw new Error('POST /v1/projects failed');
      },
    } as unknown as RemoteAuthService;
    const failingApp = express()
      .use(express.json())
      .use('/api/release-pushes', releasePushesRouter(new ReleasePushService(db, releasesFake, failingRemote, new GitService(dir, [dir]), dir)))
      .use(errorHandler);
    const writeRemoteProjectId = (remoteProjectId: string | null): void => {
      fs.writeFileSync(
        path.join(dir, '.claude4spec', 'config.json'),
        JSON.stringify({
          $schemaVersion: 4,
          name: 'test',
          remoteProjectId,
          roots: [{ id: 'pages', name: 'Pages', dir: '.', builtin: true }],
          git: { enabled: true, syncPushOnPush: true },
        }),
      );
    };
    const rows = () =>
      db.prepare('SELECT remote_project_id, status FROM release_push ORDER BY id').all() as Array<{
        remote_project_id: string | null;
        status: string;
      }>;

    // First push: the peer never returned project.id, config.remoteProjectId is still null.
    writeRemoteProjectId(null);
    expect((await request(failingApp).post('/api/release-pushes').send({ releaseName: 'v1' })).status).toBe(502);
    expect(rows()).toEqual([{ remote_project_id: null, status: 'error' }]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM release_push WHERE remote_project_id = ''`).get()).toEqual({ n: 0 });

    // Subsequent push: the known config.remoteProjectId is persisted on the error row.
    writeRemoteProjectId('11111111-2222-3333-4444-555555555555');
    expect((await request(failingApp).post('/api/release-pushes').send({ releaseName: 'v1' })).status).toBe(502);
    expect(rows()[1]).toEqual({ remote_project_id: '11111111-2222-3333-4444-555555555555', status: 'error' });

    // The DTO: remoteProjectId optional — undefined (absent) on the first-push error row.
    const log = await request(app).get('/api/release-pushes').query({ releaseName: 'v1' });
    const items = log.body.items as ReleasePushResponse[];
    const firstPushError = items.find((p) => p.status === 'error' && p.remoteProjectId === undefined);
    expect(firstPushError).toBeDefined();
    expect('remoteProjectId' in (firstPushError as object)).toBe(false);
    expect(items.some((p) => p.status === 'error' && p.remoteProjectId === '11111111-2222-3333-4444-555555555555')).toBe(true);
  });

  it('[entity:release-push-response] detached HEAD fails the pushOnPush gate even with an explicit target branch — gitSync: null, nothing is git-pushed', async () => {
    await git(['checkout', '-b', 'release-target'], dir);
    await commitFile(dir, 'release.md', 'release', 'release marker');
    await git(['checkout', '--detach'], dir);
    const markerFile = path.join(dir, 'release.md');

    const res = await request(appWithReleaseFile(markerFile)).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body).toHaveProperty('gitSync', null);
    await expect(git(['rev-parse', '--verify', 'refs/heads/release-target'], bare)).rejects.toThrow();
  });
});

/** Dto `release-push-response` on the live payload — every required field with its type, `gitSync` an object or `null`. */
function expectReleasePushPayload(body: Record<string, unknown>): void {
  expect(typeof body.id).toBe('number');
  expect(typeof body.releaseId).toBe('number');
  expect(body.release).toEqual({ id: expect.any(Number), name: expect.any(String) });
  expect(body.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(typeof body.contentSizeBytes).toBe('number');
  expect(typeof body.deduplicated).toBe('boolean');
  expect(typeof body.pushedByAccountId).toBe('string');
  expect(typeof body.bundleSchemaVersion).toBe('number');
  expect(['success', 'error']).toContain(body.status);
  expect(typeof body.pushedAt).toBe('string');
  expect('gitSync' in body).toBe(true);
  expect(body.gitSync === null || typeof body.gitSync === 'object').toBe(true);
}

/**
 * 2.1.11 — the push and its audit log address the release by name. The numeric
 * id stays in the response (`releaseId`, `release: { id, name }`) only.
 */
describe('/api/release-pushes — release addressed by name (2.1.11)', () => {
  it('POST { releaseName } pushes that release', async () => {
    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ releaseId, release: { id: releaseId, name: 'v1' }, status: 'success' });
  });

  it('POST with an unknown name is 404 RELEASE_NOT_FOUND', async () => {
    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'nope' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RELEASE_NOT_FOUND');
  });

  it('[2.1.23] POST with the name "current" is 404 RELEASE_NOT_FOUND even when a release named current exists', async () => {
    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'current' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RELEASE_NOT_FOUND');
  });

  it('POST with the pre-2.1.11 { releaseId } body is a 400 VALIDATION', async () => {
    const res = await request(app).post('/api/release-pushes').send({ releaseId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('GET ?releaseName= returns only that release\'s pushes; an unknown name answers an empty list', async () => {
    await request(app).post('/api/release-pushes').send({ releaseName: 'v1' }).expect(201);

    const own = await request(app).get('/api/release-pushes').query({ releaseName: 'v1' });
    expect(own.status).toBe(200);
    expect(own.body.items).toHaveLength(1);
    expect(own.body.items[0]).toMatchObject({ releaseId, release: { name: 'v1' } });

    const unknown = await request(app).get('/api/release-pushes').query({ releaseName: 'nope' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.items).toEqual([]);
  });
});
