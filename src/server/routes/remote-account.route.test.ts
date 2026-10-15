import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { RemoteAuthService } from '../services/remote-auth.js';
import type { RemoteHttpClient } from '../services/remote-http-client.js';
import { remoteAccountRouter } from './remote-account.js';

/**
 * M24 — `POST /api/remote-account/logout`, the request the settings page's User
 * card sends after its ConfirmModal (the UI half is pinned in
 * `src/client/components/account/UserCardElement.render.test.ts`). The session is
 * a real `remote_session` table (migration 030); logout never calls the remote.
 */
const MIGRATION = fs.readFileSync(
  fileURLToPath(new URL('../db/migrations/030_remote_session.sql', import.meta.url)),
  'utf8',
);

let db: Database.Database;
const app = () =>
  express()
    .use(express.json())
    .use('/api/remote-account', remoteAccountRouter(new RemoteAuthService(db, {} as unknown as RemoteHttpClient)));

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(MIGRATION);
  db.prepare(
    `INSERT INTO remote_session (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
     VALUES ('tok-1', 'tid-1', '2026-10-01T00:00:00Z', 'acc-1', 'ada@example.com', 'active')`,
  ).run();
});

afterEach(() => {
  db.close();
});

describe('POST /api/remote-account/logout (M24)', () => {
  it('[ac:ac-logout-w-m26-sekcja-user-z-confirmmodal] logout deletes remote_session and GET /api/remote-account then reports connected: false', async () => {
    const before = await request(app()).get('/api/remote-account');
    expect(before.body.connected).toBe(true);
    expect(before.body.accountEmail).toBe('ada@example.com');
    expect(before.body).not.toHaveProperty('access_token');

    const res = await request(app()).post('/api/remote-account/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
    expect((db.prepare('SELECT COUNT(*) AS n FROM remote_session').get() as { n: number }).n).toBe(0);

    const after = await request(app()).get('/api/remote-account');
    expect(after.body).toEqual({ connected: false });
  });
});
