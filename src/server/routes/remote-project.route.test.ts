import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { readConfig, writeConfig } from '../config.js';
import { RemoteAuthService } from '../services/remote-auth.js';
import { RemoteRequestError, type RemoteHttpClient } from '../services/remote-http-client.js';
import { remoteProjectRouter } from './remote-project.js';

/**
 * M25/M26 — `/api/remote-project`, the local proxy the settings page's
 * `#remote-project` card reads and edits through. The remote service is the
 * `RemoteHttpClient` seam, stubbed; the session lives in a real `remote_session`
 * table (migration 030). What the card renders from these bodies is pinned in
 * `src/client/components/release/RemoteProjectElement.render.test.ts`.
 */
const MIGRATION = fs.readFileSync(
  fileURLToPath(new URL('../db/migrations/030_remote_session.sql', import.meta.url)),
  'utf8',
);
const PROJECT_ID = '7d0c3c0e-1f7a-4a53-9a4e-2b1b3f0d9c11';

let cwd: string;
let db: Database.Database;
let client: { getProject: ReturnType<typeof vi.fn>; updateProject: ReturnType<typeof vi.fn> };

function seedSession() {
  db.prepare(
    `INSERT INTO remote_session (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
     VALUES ('tok-1', 'tid-1', '2026-10-01T00:00:00Z', 'acc-1', 'ada@example.com', 'active')`,
  ).run();
}

const app = () =>
  express()
    .use(express.json())
    .use('/api/remote-project', remoteProjectRouter(new RemoteAuthService(db, client as unknown as RemoteHttpClient), cwd));

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-remote-project-'));
  writeConfig(cwd, { remoteProjectId: PROJECT_ID });
  db = new Database(':memory:');
  db.exec(MIGRATION);
  client = { getProject: vi.fn(), updateProject: vi.fn() };
});

afterEach(() => {
  db.close();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/remote-project — the not-found family', () => {
  it('[ac:ac-anonim-bez-sesji-konta-zdalnego-przy] an anonymous reader (no session) of a draft project gets reason not_found — the same body as a deleted project or an invalid identifier', async () => {
    // The remote hides a draft from anyone but its owner: 404 to an unauthenticated read.
    client.getProject.mockRejectedValue(new RemoteRequestError('project not found', 404));
    const anon = await request(app()).get('/api/remote-project');
    expect(anon.status).toBe(200);
    expect(client.getProject).toHaveBeenCalledWith(null, PROJECT_ID); // no bearer: anonymous
    expect(anon.body).toEqual({ linked: true, projectId: PROJECT_ID, fetched: false, isOwner: false, reason: 'not_found' });

    // A signed-in reader of a deleted project / a bad identifier: the remote answers the same 404.
    seedSession();
    const deleted = await request(app()).get('/api/remote-project');
    expect(client.getProject).toHaveBeenLastCalledWith('tok-1', PROJECT_ID);
    expect(deleted.body).toEqual(anon.body);
  });

  it('[ac:ac-sekcja-remote-project-gdy-projekt-usunie] a remote 404 (deleted / foreign draft / bad UUID) answers { linked: true, fetched: false, isOwner: false, reason: not_found } and leaves remoteProjectId in config', async () => {
    seedSession();
    client.getProject.mockRejectedValue(new RemoteRequestError('project not found', 404));
    const res = await request(app()).get('/api/remote-project');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, projectId: PROJECT_ID, fetched: false, isOwner: false, reason: 'not_found' });
    // No auto-clear: the link stays until the user disconnects.
    expect(readConfig(cwd).remoteProjectId).toBe(PROJECT_ID);
  });
});

describe('PATCH /api/remote-project — refusals the card shows', () => {
  it('[ac:ac-odmowa-edycji-projektu-zdalnego-kodem] a remote 403 is answered as 403 NOT_OWNER', async () => {
    seedSession();
    client.updateProject.mockRejectedValue(new RemoteRequestError('forbidden', 403));
    const res = await request(app()).patch('/api/remote-project').send({ name: 'Renamed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_OWNER');
    expect(client.updateProject).toHaveBeenCalledWith('tok-1', PROJECT_ID, { name: 'Renamed' });
  });

  it('[ac:ac-odmowa-422-invalid-body-z-uslugi-zdal] a remote 422 for a value the local checks let through is answered as 422 INVALID_BODY with the remote message and the field it concerns', async () => {
    seedSession();
    const message = 'name must not contain reserved words';
    client.updateProject.mockRejectedValue(
      new RemoteRequestError(message, 422, { statusCode: 422, message: [message] }),
    );
    // 13 characters: valid for the local 1..120 check, so the remote is asked.
    const res = await request(app()).patch('/api/remote-project').send({ name: 'Admin project' });
    expect(client.updateProject).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({ code: 'INVALID_BODY', message, field: 'name' });
  });
});
