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
    // 2.1.11: the push resolves the release by NAME; only `v1` exists here.
    resolveReleaseId: (name: string) => {
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

  it('[entity:release-push-response] a push the remote accepts returns gitSync.status "pushed" without recovery', async () => {
    await commitFile(dir, 'mine.md', 'mine', 'my change');

    const res = await request(app).post('/api/release-pushes').send({ releaseName: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.gitSync).toMatchObject({ status: 'pushed', branch: 'main' });
    expect(res.body.gitSync?.recovery).toBeUndefined();
  });
});

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
