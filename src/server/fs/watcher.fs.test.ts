import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatchRuntime, type WatchSubscriber, type WatchScope } from './watcher.js';

/**
 * The handful of M40 properties that genuinely need a real fs provider.
 *
 * Kept in their OWN file, deliberately small and short-sleeping: every case here
 * holds a live chokidar instance, and the vitest fork pool is shared with
 * timing-sensitive suites elsewhere. Everything that can be proven without a
 * provider lives in `watcher.test.ts`, driven by `flush()`. This is the same
 * reasoning that keeps `tests/helpers/test-app.ts` from ever starting chokidar.
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m40-fs-'));
  tmpDirs.push(d);
  return d;
}

function runtime(): FileWatchRuntime {
  const r = new FileWatchRuntime();
  runtimes.push(r);
  return r;
}

function recorder(log: string[], id: string): WatchSubscriber {
  return {
    onChange: () => void log.push(id),
    onUnlink: () => void log.push(`${id}:unlink`),
  };
}

async function until(cond: () => boolean, timeoutMs = 4000, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const CTX: WatchScope = 'context:p1';

describe('M40 — flush vs the fs echo', () => {
  it('leaves an echo guard so the fs event for the same write does not dispatch twice', async () => {
    const dir = tmp();
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'capture'), { id: 'm17-capture', phase: 'capture', scope: CTX });

    r.markOrigin(CTX, 'pages:pages', 'a.md', 'user');
    fs.writeFileSync(path.join(dir, 'a.md'), 'hello');
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['capture']);

    // The chokidar echo lands ~100ms later; it must be swallowed.
    await new Promise((res) => setTimeout(res, 550));
    expect(log).toEqual(['capture']);
  });
});

describe('M40 — fs provider behaviour', () => {
  it('a second save inside the self-write window still dispatches', async () => {
    // Regression for the defect that made `capture` lose an edit outright: the
    // route write and the anchor write-back both touch the same file, chokidar
    // coalesces them into ONE event, and the old token queue was left holding a
    // live `suppress`. The next save then popped that stale token and never
    // dispatched — no version row, no reindex, HTTP 200 all the same.
    const dir = tmp();
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    const file = path.join(dir, 'a.md');

    const captures: string[] = [];
    r.subscribe(
      'pages:pages',
      {
        onChange: () => {
          const body = fs.readFileSync(file, 'utf-8');
          if (body.includes('anchor:')) return;
          r.suppress(CTX, 'pages:pages', 'a.md');
          fs.writeFileSync(file, `<!-- anchor: abc123 -->\n${body}`);
        },
        onUnlink: () => {},
      },
      { id: 'm06-anchor-injection', phase: 'write-back', scope: CTX },
    );
    r.subscribe(
      'pages:pages',
      { onChange: (_s, _src, _p) => void captures.push(fs.readFileSync(file, 'utf-8')), onUnlink: () => {} },
      { id: 'm17-capture', phase: 'capture', after: ['write-back'], scope: CTX },
    );

    // Two saves back to back, well inside the 600 ms self-write window.
    r.markOrigin(CTX, 'pages:pages', 'a.md', 'user');
    fs.writeFileSync(file, '# One\n');
    await r.flush(CTX, 'pages:pages', 'a.md');

    r.markOrigin(CTX, 'pages:pages', 'a.md', 'user');
    fs.writeFileSync(file, '# Two\n');
    await r.flush(CTX, 'pages:pages', 'a.md');

    expect(captures.length).toBe(2);
    expect(captures[1]).toContain('# Two');

    // ...and neither write's fs echo adds a third.
    await new Promise((res) => setTimeout(res, 800));
    expect(captures.length).toBe(2);
  });

  it('an external edit is never masked by a leftover self-write token', async () => {
    const dir = tmp();
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    const file = path.join(dir, 'b.md');
    const seen: string[] = [];
    r.subscribe(
      'pages:pages',
      { onChange: (_s, _src, _p, origin) => void seen.push(origin), onUnlink: () => {} },
      { id: 'm02-notify', phase: 'notification', scope: CTX },
    );

    // A suppress that never gets its event (the write failed, say).
    r.suppress(CTX, 'pages:pages', 'b.md');
    await new Promise((res) => setTimeout(res, 700)); // outlive the window

    fs.writeFileSync(file, 'external edit\n');
    expect(await until(() => seen.length > 0)).toBe(true);
    expect(seen).toEqual(['external']);
  });

  it('a server write whose own write-back rewrites the same file dispatches exactly once', async () => {
    // Regression: one dispatch legitimately produces TWO writes to the same path
    // — the server write (markOrigin) and, inside its own reaction chain, the M06
    // anchor write-back (suppress). With one token slot per key the second token
    // overwrote the first, the first fs echo consumed the survivor, and the
    // write-back's own echo arrived unguarded — minting a spurious extra
    // `file_version` row. Caught by the live smoke test, not by any unit test.
    const dir = tmp();
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    const file = path.join(dir, 'a.md');
    fs.writeFileSync(file, '# Heading\n');

    const captures: string[] = [];
    r.subscribe(
      'pages:pages',
      {
        onChange: () => {
          if (fs.readFileSync(file, 'utf-8').includes('anchor:')) return;
          r.suppress(CTX, 'pages:pages', 'a.md');
          fs.writeFileSync(file, '<!-- anchor: abc123 -->\n# Heading\n');
        },
        onUnlink: () => {},
      },
      { id: 'm06-anchor-injection', phase: 'write-back', scope: CTX },
    );
    r.subscribe(
      'pages:pages',
      { onChange: () => void captures.push('capture'), onUnlink: () => {} },
      { id: 'm17-capture', phase: 'capture', after: ['write-back'], scope: CTX },
    );

    r.markOrigin(CTX, 'pages:pages', 'a.md', 'user');
    fs.writeFileSync(file, '# Heading\n\nedited\n');
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(captures).toEqual(['capture']);

    // Both fs echoes (the server write's and the write-back's) must be swallowed.
    await new Promise((res) => setTimeout(res, 800));
    expect(captures).toEqual(['capture']);
  });

  it('debounces a burst of writes to a single dispatch', async () => {
    const dir = tmp();
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-idx', phase: 'projection', scope: CTX });

    const file = path.join(dir, 'burst.md');
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(file, `v${i}`);
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(await until(() => log.length > 0)).toBe(true);
    await new Promise((res) => setTimeout(res, 400));
    expect(log).toEqual(['proj']);
  });

  it('[ac:ac-usuniecie-folderu-emituje-osobne-zdarzen] deleting a folder emits one unlink per file', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub/a.md'), 'a');
    fs.writeFileSync(path.join(dir, 'sub/b.md'), 'b');

    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    const seen: string[] = [];
    r.subscribe(
      'pages:pages',
      { onChange: () => {}, onUnlink: (_s, _src, rel) => void seen.push(rel) },
      { id: 'm17-capture', phase: 'capture', scope: CTX },
    );

    await new Promise((res) => setTimeout(res, 300));
    fs.rmSync(path.join(dir, 'sub'), { recursive: true, force: true });

    expect(await until(() => seen.length >= 2)).toBe(true);
    expect(seen.sort()).toEqual(['sub/a.md', 'sub/b.md']);
  });
});
