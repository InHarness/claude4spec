import { describe, expect, it, vi } from 'vitest';
import { PROD_REMOTE_URL, RemoteHttpClient, effectiveRemoteUrl, remoteAddressIdentity } from './remote-http-client.js';

describe('RemoteHttpClient base URL resolution', () => {
  it('[ac:ac-base-url-zdalnego-api-to-hardcoded-sta-a] defaults to the hardcoded production remote and lets config.remoteApiUrl override', () => {
    // Hardcoded production constant (M24) — a real https host, not a placeholder.
    expect(PROD_REMOTE_URL).toBe('https://claude4spec.inharness.ai');
    expect(PROD_REMOTE_URL).toMatch(/^https:\/\//);

    // No override → falls back to the hardcoded production base.
    expect(effectiveRemoteUrl(undefined, null)).toBe(PROD_REMOTE_URL);
    expect(effectiveRemoteUrl(undefined, undefined)).toBe(PROD_REMOTE_URL);

    // config.remoteApiUrl override (dev/staging) wins over the hardcoded default.
    expect(effectiveRemoteUrl(undefined, 'http://localhost:3000')).toBe('http://localhost:3000');

    // Trailing slashes are normalised away; the client talks to the resolved address.
    expect(effectiveRemoteUrl(undefined, 'http://localhost:3000/')).toBe('http://localhost:3000');
    expect(new RemoteHttpClient(effectiveRemoteUrl(undefined, 'http://localhost:3000/')).base).toBe('http://localhost:3000');
  });

  it('[section:ux690pt2] the effective address is the --remote-url flag over config.remoteApiUrl over the production constant; an empty value is no override', () => {
    // Flag > config.
    expect(effectiveRemoteUrl('https://flag.example', 'https://config.example')).toBe('https://flag.example');
    // Flag > production constant.
    expect(effectiveRemoteUrl('https://flag.example', null)).toBe('https://flag.example');
    // Config > production constant.
    expect(effectiveRemoteUrl(undefined, 'https://config.example')).toBe('https://config.example');
    // Neither → production constant.
    expect(effectiveRemoteUrl(undefined, null)).toBe(PROD_REMOTE_URL);
    // An empty value at either level falls through to the next one.
    expect(effectiveRemoteUrl('', 'https://config.example')).toBe('https://config.example');
    expect(effectiveRemoteUrl(undefined, '')).toBe(PROD_REMOTE_URL);
    // Equal addresses compare equal however they are spelled at the end.
    expect(effectiveRemoteUrl('https://flag.example/', null)).toBe(effectiveRemoteUrl('https://flag.example', null));
  });

  it('[section:ux690pt2] differently-spelled same address has one identity: host case, a default port and trailing slashes do not make another address', () => {
    const same = ['https://remote.example', 'https://Remote.EXAMPLE', 'https://remote.example:443/', ' HTTPS://remote.example// '];
    for (const spelling of same) expect(remoteAddressIdentity(spelling)).toBe('https://remote.example');
    // The effective address at every level has that one identity (it is the
    // fetch base, so it keeps its spelling; the identity is taken from it).
    expect(remoteAddressIdentity(effectiveRemoteUrl('https://Remote.example:443/', null))).toBe('https://remote.example');
    expect(remoteAddressIdentity(effectiveRemoteUrl(undefined, 'HTTP://LocalHost:80/'))).toBe('http://localhost');
    // The path is part of the address (case kept); a non-default port is kept.
    expect(remoteAddressIdentity('https://Remote.example/API/')).toBe('https://remote.example/API');
    expect(remoteAddressIdentity('https://remote.example:8443')).toBe('https://remote.example:8443');
    expect(remoteAddressIdentity('http://localhost:3000')).not.toBe(remoteAddressIdentity('http://localhost:3001'));
  });

  it('[section:ux690pt2] the fetch base keeps the configured query exactly; only the path loses its trailing slashes; the issuer compare uses the identity form', async () => {
    const configured = 'https://Remote.example:443/api/?tenant=x';
    const base = effectiveRemoteUrl(configured, null);
    // The base is the configured address: trimmed, the path's trailing slashes dropped.
    expect(base).toBe('https://Remote.example:443/api?tenant=x');
    // A query value ending in '/' is kept character for character.
    expect(effectiveRemoteUrl(undefined, ' https://remote.example/api//?tenant=x// ')).toBe(
      'https://remote.example/api?tenant=x//',
    );
    expect(effectiveRemoteUrl('https://remote.example/?next=/', null)).toBe('https://remote.example?next=/');

    // The request goes to the base's own path, with its query kept.
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          device_code: 'dc',
          user_code: 'U',
          verification_uri: 'https://remote.example/device',
          verification_uri_complete: 'https://remote.example/device?code=U',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    try {
      await new RemoteHttpClient(base).startDeviceFlow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!);
    expect(url.search).toBe('?tenant=x');
    expect(url.pathname).toBe('/api/v1/auth/device/code');
    expect(url.host).toBe('remote.example');

    // The identity compare still matches differently-spelled same addresses.
    expect(remoteAddressIdentity(base)).toBe('https://remote.example/api');
    expect(remoteAddressIdentity(base)).toBe(remoteAddressIdentity('https://REMOTE.example/api/'));
    expect(remoteAddressIdentity(base)).toBe(remoteAddressIdentity(effectiveRemoteUrl(undefined, 'https://remote.example:443/api')));
  });
});
