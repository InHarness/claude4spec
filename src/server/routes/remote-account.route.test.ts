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
