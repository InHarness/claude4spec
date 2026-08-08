import { describe, expect, it } from 'vitest';
import { AgentError, encodeArtifactPath } from './http.js';

/**
 * `encodeArtifactPath` — the traversal guard that could not move to the server.
 *
 * The bug it exists for is subtle enough to be worth restating: the naive
 * translation of a filesystem read into a URL is
 * `p.split('/').map(encodeURIComponent).join('/')`, and that looks like it
 * carries the path verbatim. It does not. `encodeURIComponent` has nothing to
 * escape in `..`, and `fetch` resolves the URL — collapsing the dot segments —
 * before the request leaves the process. So the traversal is not refused by the
 * server, because the server is never asked about it: it receives a request for
 * a completely different endpoint, and answers 200.
 */
describe('encodeArtifactPath', () => {
  it('encodes each segment without touching the separators', () => {
    expect(encodeArtifactPath('sub/a b.md')).toBe('sub/a%20b.md');
    expect(encodeArtifactPath('0-2-12-to-0-2-13.md')).toBe('0-2-12-to-0-2-13.md');
    // A `#` or `?` in a filename must not start a fragment or a query.
    expect(encodeArtifactPath('a#b?c.md')).toBe('a%23b%3Fc.md');
  });

  it('refuses `..`, in any position', () => {
    for (const p of ['../x.md', 'a/../../x.md', 'a/..', '..']) {
      expect(() => encodeArtifactPath(p), p).toThrow(AgentError);
      expect(() => encodeArtifactPath(p), p).toThrow(/escapes the artifact directory/);
    }
  });

  it('normalizes a single-dot segment instead of refusing it', () => {
    /**
     * `.` resolves to the directory it is already in, so it escapes nothing —
     * and `path.join`, shell completion and hand-typed paths all produce that
     * spelling. Refusing it made `c4s read-brief ./x.md` exit 4 claiming the
     * path "escapes the artifact directory", which was both a refusal of
     * something safe and a false description of it.
     *
     * It also has to match the server: `assertSafeRelPath` normalizes first, so
     * `file-patch --brief ./x.md` accepted the identical string this rejected.
     */
    expect(encodeArtifactPath('./x.md')).toBe('x.md');
    expect(encodeArtifactPath('./a/./b.md')).toBe('a/b.md');
    // An empty segment survives in a URL and addresses nothing.
    expect(encodeArtifactPath('a//b.md')).toBe('a/b.md');
  });

  it('refuses an absolute path, and a path that names nothing', () => {
    // A leading `/` resets URL resolution to the ORIGIN, so `/api/health` as a
    // "brief path" would address the health endpoint and answer 200.
    expect(() => encodeArtifactPath('/api/health')).toThrow(AgentError);
    // Normalization can empty a path; an empty suffix would address the
    // collection endpoint rather than an artifact.
    expect(() => encodeArtifactPath('./')).toThrow(/names no artifact/);
  });

  it('refuses with INVALID_ARGS, which the CLI maps to exit 4', () => {
    try {
      encodeArtifactPath('../../config');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as AgentError).code).toBe('INVALID_ARGS');
      expect((err as AgentError).hint).toMatch(/relative/);
    }
  });

  it('a dot INSIDE a segment is not a traversal', () => {
    // `..foo` and `a..b` are ordinary filenames; refusing them would be a
    // different bug from the one this prevents.
    expect(encodeArtifactPath('..foo.md')).toBe('..foo.md');
    expect(encodeArtifactPath('a/b..c.md')).toBe('a/b..c.md');
  });

  /**
   * The proof that the guard is load-bearing rather than defensive: without it,
   * this is the URL that would be requested.
   */
  it('demonstrates what URL resolution does to an unguarded traversal', () => {
    const naive = '../../config'.split('/').map(encodeURIComponent).join('/');
    expect(naive).toBe('../../config');
    const resolved = new URL(naive, 'http://x/api/projects/abc/artifacts/brief/');
    expect(resolved.pathname).toBe('/api/projects/abc/config');
  });
});
