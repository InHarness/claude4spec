import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { RemoteAuthService } from '../services/remote-auth.js';
import { RemoteUnauthorizedError, type RemoteHttpClient } from '../services/remote-http-client.js';
import { remoteAccountRouter } from './remote-account.js';

/**
 * M24 — `POST /api/remote-account/logout`, the request the settings page's User
 * card sends after its ConfirmModal (the UI half is pinned in
 * `src/client/components/account/UserCardElement.render.test.ts`). The session is
 * a real `remote_session` table (migration 030 + 063's `issuer_url`); logout never
 * calls the remote. 2.1.58: a session counts only under the address that issued
 * it, so every fake client here stands on `ISSUER` and the seeded row records it.
 */
const MIGRATIONS = ['030_remote_session.sql', '063_remote_session_issuer_url.sql'].map((file) =>
  fs.readFileSync(fileURLToPath(new URL(`../db/migrations/${file}`, import.meta.url)), 'utf8'),
);
const ISSUER = 'https://remote.example';

// A login encrypts the token with the M05 keyring (`secret.key` under `C4S_HOME`) —
// a throwaway home, never the real one.
let tmpHome: string;
const prevHome = process.env.C4S_HOME;
beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-remote-account-'));
  process.env.C4S_HOME = tmpHome;
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.C4S_HOME;
  else process.env.C4S_HOME = prevHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

let db: Database.Database;
const sessionCount = () => (db.prepare('SELECT COUNT(*) AS n FROM remote_session').get() as { n: number }).n;
const app = () =>
  express()
    .use(express.json())
    .use('/api/remote-account', remoteAccountRouter(new RemoteAuthService(db, { base: ISSUER } as unknown as RemoteHttpClient)));

beforeEach(() => {
  db = new Database(':memory:');
  for (const sql of MIGRATIONS) db.exec(sql);
  db.prepare(
    `INSERT INTO remote_session (access_token, issuer_url, token_id, issued_at, remote_account_id, account_email, account_status)
     VALUES ('tok-1', ?, 'tid-1', '2026-10-01T00:00:00Z', 'acc-1', 'ada@example.com', 'active')`,
  ).run(ISSUER);
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

describe('POST /api/remote-account/logout — the remote_session row (M24)', () => {
  it('[ac:ac-logout-kasuje-wiersz-remote-session-zer] logout deletes the remote_session row — zero rows after the operation, also when repeated', async () => {
    expect(sessionCount()).toBe(1);

    await request(app()).post('/api/remote-account/logout').expect(200);
    expect(sessionCount()).toBe(0);

    // Idempotent: a second logout on an empty table still leaves zero rows.
    await request(app()).post('/api/remote-account/logout').expect(200);
    expect(sessionCount()).toBe(0);
  });
});

describe('HTTP 401 from an owner-only remote endpoint (M24)', () => {
  it('[ac:ac-po-http-401-z-owner-only-endpointu-zdaln] a 401 from GET /v1/account wipes the local remote_session and requires a new device flow', async () => {
    expect(sessionCount()).toBe(1);
    const client = {
      base: ISSUER,
      startDeviceFlow: async () => ({
        device_code: 'dc-401',
        user_code: 'QRST-0401',
        verification_uri: 'https://remote.example/device',
        verification_uri_complete: 'https://remote.example/device?code=QRST-0401',
        expires_in: 900,
        interval: 5,
      }),
      pollDeviceToken: async () => ({
        ok: true as const,
        token: { access_token: 'tok-revoked', token_type: 'Bearer' as const, token_id: 'tid-9', account_id: 'acc-9', issued_at: '2026-10-27T00:00:00Z' },
      }),
      getAccount: async () => {
        throw new RemoteUnauthorizedError();
      },
    } as unknown as RemoteHttpClient;
    const authApp = express()
      .use(express.json())
      .use('/api/remote-account', remoteAccountRouter(new RemoteAuthService(db, client)));

    await request(authApp).post('/api/remote-account/login/start').expect(200);
    const poll = await request(authApp).post('/api/remote-account/login/poll');
    expect(poll.status).toBe(401);
    expect(poll.body.error.code).toBe('REMOTE_UNAUTHORIZED');

    // The local session is gone …
    expect(sessionCount()).toBe(0);
    expect((await request(authApp).get('/api/remote-account')).body).toEqual({ connected: false });
    // … and the old flow is dropped: polling again needs a new login/start.
    const again = await request(authApp).post('/api/remote-account/login/poll');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('NO_ACTIVE_FLOW');
  });
});

describe('GET /api/remote-account (M24)', () => {
  const FIELDS = ['connected', 'remoteAccountId', 'accountEmail', 'accountStatus', 'connectedAt'];

  it('[entity:get-api-remote-account] GET /api/remote-account answers 200 with the RemoteAccountResponse of the single remote_session row, never the token, and { connected: false } once no row exists', async () => {
    const res = await request(app()).get('/api/remote-account');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connected: true,
      remoteAccountId: 'acc-1',
      accountEmail: 'ada@example.com',
      accountStatus: 'active',
    });
    expect(JSON.stringify(res.body)).not.toContain('tok-1');

    db.prepare('DELETE FROM remote_session').run();
    const empty = await request(app()).get('/api/remote-account');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ connected: false });
  });

  it('[entity:remote-account-response] the payload carries exactly connected, remoteAccountId, accountEmail, accountStatus and connectedAt with their types — no token, no push/publish linkage', async () => {
    const res = await request(app()).get('/api/remote-account');
    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...FIELDS].sort());
    expect(typeof body.connected).toBe('boolean');
    expect(typeof body.remoteAccountId).toBe('string');
    expect(typeof body.accountEmail).toBe('string');
    expect(['active', 'deactivated']).toContain(body.accountStatus);
    expect(typeof body.connectedAt).toBe('string');
    for (const k of ['access_token', 'accessToken', 'token_id', 'remoteProjectId', 'canPush', 'canPublish']) {
      expect(body, k).not.toHaveProperty(k);
    }
  });

  it('[ac:ac-konto-z-account-status-deactivated-po] a login whose account is deactivated still saves the remote_session row, and GET /api/remote-account reports it connected with accountStatus deactivated', async () => {
    db.prepare('DELETE FROM remote_session').run();
    const client = {
      base: ISSUER,
      startDeviceFlow: async () => ({
        device_code: 'dc-1',
        user_code: 'WXYZ-1234',
        verification_uri: 'https://remote.example/device',
        verification_uri_complete: 'https://remote.example/device?code=WXYZ-1234',
        expires_in: 900,
        interval: 5,
      }),
      pollDeviceToken: async () => ({
        ok: true as const,
        token: { access_token: 'tok-2', token_type: 'Bearer' as const, token_id: 'tid-2', account_id: 'acc-2', issued_at: '2026-10-27T00:00:00Z' },
      }),
      getAccount: async () => ({ id: 'acc-2', email: 'grace@example.com', status: 'deactivated' as const }),
    } as unknown as RemoteHttpClient;
    const service = new RemoteAuthService(db, client);
    const loginApp = express().use(express.json()).use('/api/remote-account', remoteAccountRouter(service));

    await request(loginApp).post('/api/remote-account/login/start').expect(200);
    const poll = await request(loginApp).post('/api/remote-account/login/poll');
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe('authorized');

    // The session is saved although the account is deactivated.
    const rows = db.prepare('SELECT remote_account_id, account_status FROM remote_session').all();
    expect(rows).toEqual([{ remote_account_id: 'acc-2', account_status: 'deactivated' }]);

    const res = await request(loginApp).get('/api/remote-account');
    expect(res.body).toMatchObject({ connected: true, accountEmail: 'grace@example.com', accountStatus: 'deactivated' });
  });
});
