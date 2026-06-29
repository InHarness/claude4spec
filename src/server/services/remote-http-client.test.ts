import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('RemoteHttpClient.createProject — X-Project-Name encoding (M25)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[ac:ac-first-push-z-nazwa-projektu-zawierajaca] percent-encodes a non-ASCII project name (UTF-8) so the undici/fetch header value does not throw', async () => {
    // A real (empty) bundle file so streamBundle's createReadStream has a path to open.
    const dir = mkdtempSync(join(tmpdir(), 'c4s-push-'));
    const tarGzPath = join(dir, 'bundle.tar.gz');
    writeFileSync(tarGzPath, '');

    let captured: Record<string, string> | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({ project: { id: 'p1', slug: 's', name: 'x', description: null, createdAt: '' }, release: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RemoteHttpClient('http://localhost:9999');
    const name = 'Zażółć 🚀 项目';

    // Must not throw on the header value (raw Unicode would crash the Latin-1 header serializer).
    await expect(
      client.createProject('tok', { tarGzPath, sizeBytes: 0, sha256: 'a'.repeat(64) }, name),
    ).resolves.toBeTruthy();

    // The header carries the percent-encoded UTF-8 form; the peer recovers it via decodeURIComponent.
    expect(captured?.['x-project-name']).toBe(encodeURIComponent(name));
    expect(decodeURIComponent(captured!['x-project-name'])).toBe(name);
    // Percent-encoded value is pure ASCII — safe for an HTTP header.
    expect(captured!['x-project-name']).toMatch(/^[\x20-\x7e]*$/);
  });
});
