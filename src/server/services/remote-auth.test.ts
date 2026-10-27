import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbAt } from '../db/index.js';
import { RemoteAuthService } from './remote-auth.js';
import { decrypt } from './agent-credential-crypto.js';
import type { RemoteHttpClient } from './remote-http-client.js';

/**
 * M24 — the session `RemoteAuthService` writes after a device-flow login, on a
 * real project database file (`openDbAt`, migrations included). 2.1.57
 * (yuhlv2qw): the token lands encrypted with the M05 primitive.
 */

// The keyring (`secret.key`) and the database file live under a throwaway home.
let tmpHome: string;
const prevHome = process.env.C4S_HOME;
beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-remote-auth-'));
  process.env.C4S_HOME = tmpHome;
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.C4S_HOME;
  else process.env.C4S_HOME = prevHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const TOKEN = 'tok-secret-0123456789';

const fakeClient = (): RemoteHttpClient =>
  ({
    startDeviceFlow: async () => ({
      device_code: 'dc-1',
      user_code: 'ABCD-1234',
      verification_uri: 'https://remote.example/device',
      verification_uri_complete: 'https://remote.example/device?code=ABCD-1234',
      expires_in: 900,
      interval: 5,
    }),
    pollDeviceToken: async () => ({
      ok: true as const,
      token: { access_token: TOKEN, token_type: 'Bearer' as const, token_id: 'tid-1', account_id: 'acc-1', issued_at: '2026-10-27T00:00:00Z' },
    }),
    getAccount: async () => ({ id: 'acc-1', email: 'ada@example.com', status: 'active' as const }),
  }) as unknown as RemoteHttpClient;

async function login(service: RemoteAuthService): Promise<void> {
  await service.startDeviceFlow();
  const poll = await service.pollDeviceFlow();
  expect(poll.status).toBe('authorized');
}

describe('RemoteAuthService — remote_session persistence (M24)', () => {
  it('[entity:remote-session] a login stores access_token encrypted with the M05 primitive — never the token itself — and it decrypts back to the token', async () => {
    const db = openDbAt(path.join(tmpHome, 'encrypt.sqlite'));
    await login(new RemoteAuthService(db.handle, fakeClient()));

    const row = db.handle.prepare('SELECT access_token FROM remote_session').get() as { access_token: string };
    expect(row.access_token).not.toBe(TOKEN);
    expect(row.access_token).not.toContain(TOKEN);
    expect(decrypt(row.access_token)).toBe(TOKEN);
    db.close();
  });

  it('[ac:ac-token-zdalnej-sesji-prze-ywa-restart-ser] the session token survives a server restart: after the database is closed and reopened the remote_session row is still there with the same token', async () => {
    const file = path.join(tmpHome, 'restart.sqlite');
    const first = openDbAt(file);
    await login(new RemoteAuthService(first.handle, fakeClient()));
    first.close(); // the server stops; no process memory survives

    const second = openDbAt(file);
    const service = new RemoteAuthService(second.handle, fakeClient());
    expect(service.getCurrentAccount()).toMatchObject({ connected: true, remoteAccountId: 'acc-1', accountEmail: 'ada@example.com' });
    const row = second.handle.prepare('SELECT access_token FROM remote_session').get() as { access_token: string };
    expect(decrypt(row.access_token)).toBe(TOKEN);
    second.close();
  });
});
