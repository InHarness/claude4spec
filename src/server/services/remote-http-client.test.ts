import { describe, expect, it } from 'vitest';
import { PROD_REMOTE_URL, RemoteHttpClient } from './remote-http-client.js';

describe('RemoteHttpClient base URL resolution', () => {
  it('[ac:ac-base-url-zdalnego-api-to-hardcoded-sta-a] defaults to the hardcoded production remote and lets config.remoteApiUrl override', () => {
    // Hardcoded production constant (M24) — a real https host, not a placeholder.
    expect(PROD_REMOTE_URL).toBe('https://claude4spec.inharness.ai');
    expect(PROD_REMOTE_URL).toMatch(/^https:\/\//);

    // No override → falls back to the hardcoded production base.
    expect(new RemoteHttpClient(null).base).toBe(PROD_REMOTE_URL);
    expect(new RemoteHttpClient(undefined).base).toBe(PROD_REMOTE_URL);

    // config.remoteApiUrl override (dev/staging) wins over the hardcoded default.
    expect(new RemoteHttpClient('http://localhost:3000').base).toBe('http://localhost:3000');

    // Trailing slashes are normalised away on both paths.
    expect(new RemoteHttpClient('http://localhost:3000/').base).toBe('http://localhost:3000');
  });
});
