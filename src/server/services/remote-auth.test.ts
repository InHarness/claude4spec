import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbAt } from '../db/index.js';
import { RemoteAuthService } from './remote-auth.js';
import { decrypt } from './agent-credential-crypto.js';
import { RemoteHttpClient } from './remote-http-client.js';

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

const fakeClient = (base = 'https://remote.example'): RemoteHttpClient =>
  ({
    base,
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

/**
 * 2.1.58 (M24 `ux690pt2`): the session remembers the address that issued its
 * token. Under another effective address the project is logged out: the token
 * is neither sent nor deleted, and returning to the issuer restores the session.
 * The remote is a stubbed `fetch` behind the REAL `RemoteHttpClient`, so every
 * outbound request the service makes is recorded with its headers.
 */
describe('RemoteAuthService — the session belongs to its issuer (M24 2.1.58)', () => {
  const ISSUER = 'https://issuer.example';
  const OTHER = 'https://other.example';

  interface Sent {
    url: string;
    authorization: string | null;
    body: string;
  }
  let sent: Sent[];

  /** A remote answering the device flow; `/v1/account` echoes the Bearer it got. */
  function stubRemote(poll: 'authorized' | 'pending'): void {
    sent = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      sent.push({ url, authorization: headers.get('authorization'), body: typeof init?.body === 'string' ? init.body : '' });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/v1/auth/device/code')) {
        return json(200, {
          device_code: 'dc-x',
          user_code: 'WXYZ-0001',
          verification_uri: `${url}/verify`,
          verification_uri_complete: `${url}/verify?code=WXYZ-0001`,
          expires_in: 900,
          interval: 5,
        });
      }
      if (url.endsWith('/v1/auth/device/token')) {
        return poll === 'pending'
          ? json(400, { error: 'authorization_pending' })
          : json(200, { access_token: 'tok-fresh', token_type: 'Bearer', token_id: 'tid-2', account_id: 'acc-2', issued_at: '2026-10-28T00:00:00Z' });
      }
      if (url.endsWith('/v1/account')) return json(200, { id: 'acc-2', email: 'grace@example.com', status: 'active' });
      return json(404, {});
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Logs in under ISSUER through the real client; returns the stored ciphertext. */
  async function loginAtIssuer(file: string): Promise<ReturnType<typeof openDbAt>> {
    const db = openDbAt(path.join(tmpHome, file));
    await login(new RemoteAuthService(db.handle, fakeClient(ISSUER)));
    return db;
  }

  it('[entity:remote-session] a login records the effective address it was issued under in issuer_url', async () => {
    const db = await loginAtIssuer('issuer-recorded.sqlite');
    expect(db.handle.prepare('SELECT issuer_url FROM remote_session').all()).toEqual([{ issuer_url: ISSUER }]);
    db.close();
  });

  it('[ac:ac-sesja-wydana-pod-innym-adresem-zdalne] a session issued under another remote address sends its token in no outbound call: the project reads logged out, the device flow goes out without it, and the row is neither sent nor deleted', async () => {
    const db = await loginAtIssuer('other-address.sqlite');
    const stored = db.handle.prepare('SELECT * FROM remote_session').get() as Record<string, unknown>;
    expect(decrypt(stored.access_token as string)).toBe(TOKEN);

    // The same project, now on another effective address.
    stubRemote('pending');
    const elsewhere = new RemoteAuthService(db.handle, new RemoteHttpClient(OTHER));
    expect(elsewhere.getCurrentAccount()).toEqual({ connected: false });
    await elsewhere.startDeviceFlow();
    expect((await elsewhere.pollDeviceFlow()).status).toBe('pending');

    // Every call went to the current address, and none carried the stored token.
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(call.url.startsWith(OTHER)).toBe(true);
      expect(call.authorization).toBeNull();
      expect(call.url).not.toContain(TOKEN);
      expect(call.body).not.toContain(TOKEN);
    }

    // A logout there is not this session's logout: the row stays as it was.
    elsewhere.logout();
    expect(db.handle.prepare('SELECT * FROM remote_session').get()).toEqual(stored);
    db.close();
  });

  it('[section:ux690pt2] a successful login under the other address sends only the fresh token — never the stored one — and then replaces the single row', async () => {
    const db = await loginAtIssuer('relogin.sqlite');
    stubRemote('authorized');
    const elsewhere = new RemoteAuthService(db.handle, new RemoteHttpClient(OTHER));
    await elsewhere.startDeviceFlow();
    expect((await elsewhere.pollDeviceFlow()).status).toBe('authorized');

    const bearers = sent.map((c) => c.authorization).filter((a): a is string => a !== null);
    expect(bearers).toEqual(['Bearer tok-fresh']);
    for (const call of sent) expect(`${call.url} ${call.body}`).not.toContain(TOKEN);
    const rows = db.handle.prepare('SELECT issuer_url, remote_account_id FROM remote_session').all();
    expect(rows).toEqual([{ issuer_url: OTHER, remote_account_id: 'acc-2' }]);
    db.close();
  });

  it('[section:ux690pt2] returning to the issuer restores the session; a row without issuer_url reads logged out under every address', async () => {
    const db = await loginAtIssuer('return.sqlite');
    expect(new RemoteAuthService(db.handle, fakeClient(OTHER)).getCurrentAccount()).toEqual({ connected: false });
    expect(new RemoteAuthService(db.handle, fakeClient(ISSUER)).getCurrentAccount()).toMatchObject({
      connected: true,
      remoteAccountId: 'acc-1',
      accountEmail: 'ada@example.com',
    });

    // A session written before the column (issuer_url NULL) is "logged out".
    db.handle.prepare('UPDATE remote_session SET issuer_url = NULL').run();
    for (const base of [ISSUER, OTHER]) {
      expect(new RemoteAuthService(db.handle, fakeClient(base)).getCurrentAccount()).toEqual({ connected: false });
    }
    expect((db.handle.prepare('SELECT COUNT(*) AS n FROM remote_session').get() as { n: number }).n).toBe(1);
    db.close();
  });

  it('[section:ux690pt2] a differently-spelled same address is the same issuer: the login stores the normalised address, and the other spelling reads connected and logs out', async () => {
    const db = openDbAt(path.join(tmpHome, 'same-address-spelling.sqlite'));
    await login(new RemoteAuthService(db.handle, fakeClient('https://Issuer.EXAMPLE:443/')));
    expect(db.handle.prepare('SELECT issuer_url FROM remote_session').all()).toEqual([{ issuer_url: ISSUER }]);

    const sameRemote = new RemoteAuthService(db.handle, fakeClient('https://issuer.example'));
    expect(sameRemote.getCurrentAccount()).toMatchObject({ connected: true, remoteAccountId: 'acc-1' });
    sameRemote.logout();
    expect((db.handle.prepare('SELECT COUNT(*) AS n FROM remote_session').get() as { n: number }).n).toBe(0);
    db.close();
  });
});
