import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatchRuntime, type WatchSubscriber, type WatchScope } from './watcher.js';

/**
 * M40 runtime tests. Two modes, deliberately:
 *  - `fsEvents: false` + `flush()` for everything about ordering, validation and
 *    self-writes — deterministic, no chokidar, no wall-clock debounce.
 *  - real chokidar + polling for the handful of properties that are genuinely
 *    about the fs provider (debounce coalescing, per-file unlink on rmdir).
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m40-'));
  tmpDirs.push(d);
  return d;
}

function runtime(opts: { fsEvents?: boolean } = {}): FileWatchRuntime {
  const r = new FileWatchRuntime({ fsEvents: opts.fsEvents ?? false });
  runtimes.push(r);
  return r;
}

/** Records the order subscriptions ran in. */
function recorder(log: string[], id: string, extra?: () => void | Promise<void>): WatchSubscriber {
  return {
    async onChange() {
      log.push(id);
      await extra?.();
    },
    async onUnlink() {
      log.push(`${id}:unlink`);
      await extra?.();
    },
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

describe('M40 — mount, scope, lifecycle', () => {
  it('[ac:ac-w-systemie-istnieje-dokladnie-jedno-miej] mountSource is the only way a source becomes observable', () => {
    const r = runtime();
    expect(r.isMounted('pages:pages', CTX)).toBe(false);
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    expect(r.isMounted('pages:pages', CTX)).toBe(true);
  });

  it('rejects mounting the same (scope, source) pair twice', () => {
    const r = runtime();
    r.mountSource({ source: 'entities', dir: tmp(), scope: CTX });
    expect(() => r.mountSource({ source: 'entities', dir: tmp(), scope: CTX })).toThrow(/already mounted/);
  });

  it('[ac:ac-mount-o-scope-process-np-plugins] a process-scope mount survives a context dispose', async () => {
    const r = runtime();
    r.mountSource({ source: 'plugins:base', dir: tmp(), scope: 'process' });
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });

    const log: string[] = [];
    r.subscribe('plugins:base', recorder(log, 'base'), { id: 'm33-plugin-reload', phase: 'reload', scope: 'process' });

    await r.disposeScope(CTX);

    expect(r.isMounted('pages:pages', CTX)).toBe(false);
    expect(r.isMounted('plugins:base', 'process')).toBe(true);
    await r.flush('process', 'plugins:base', 'x.js');
    expect(log).toEqual(['base']);
  });

  it('[ac:ac-dispose-projectcontext-zdejmuje-wylacz] dispose drops only this context; a sibling context stays live', async () => {
    const r = runtime();
    const other: WatchScope = 'context:p2';
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: other });

    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'p2'), { id: 'm02-x', phase: 'projection', scope: other });

    await r.disposeScope(CTX);

    expect(r.isMounted('pages:pages', CTX)).toBe(false);
    expect(r.isMounted('pages:pages', other)).toBe(true);
    await r.flush(other, 'pages:pages', 'a.md');
    expect(log).toEqual(['p2']);
  });

  it('dispose clears the disposed scope’s self-write tokens and leaves the sibling’s alone', async () => {
    const r = runtime();
    const other: WatchScope = 'context:p2';
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: other });
    r.markOrigin(CTX, 'pages:pages', 'a.md', 'user');
    r.markOrigin(other, 'pages:pages', 'a.md', 'agent');

    await r.disposeScope(CTX);

    // Guards the key-prefix consistency: tokens are keyed with the same separator
    // the scope sweep matches on, so a leaked token can't mask a later write.
    expect(r.peekActor(CTX, 'pages:pages', 'a.md')).toBeUndefined();
    expect(r.peekActor(other, 'pages:pages', 'a.md')).toBe('agent');
  });

  it('[ac:ac-subscribe-na-zrodle-ktore-nie-zosta] subscribing to an unmounted source fails fast', () => {
    const r = runtime();
    expect(() =>
      r.subscribe('pages:nope', recorder([], 'x'), { id: 'm02-x', phase: 'projection', scope: CTX }),
    ).toThrow(/unmounted source/);
  });

  it('[ac:ac-zrodlo-plugins-overlay-nie-powstaje-d] an ungated overlay simply never gets mounted', () => {
    const r = runtime();
    const trustProjectPlugins = false;
    if (trustProjectPlugins) r.mountSource({ source: 'plugins:overlay', dir: tmp(), scope: CTX });
    expect(r.isMounted('plugins:overlay', CTX)).toBe(false);
    // The gate blocks the MOUNT, so even the subscription cannot be registered.
    expect(() =>
      r.subscribe('plugins:overlay', recorder([], 'x'), { id: 'm33-overlay', phase: 'reload', scope: CTX }),
    ).toThrow(/unmounted source/);
  });
});

describe('M40 — phases and ordering', () => {
  it('[ac:ac-faza-capture-m17-widzi-tresc-pliku-j] capture runs after write-back and sees the settled file', async () => {
    const r = runtime();
    const dir = tmp();
    r.mountSource({ source: 'pages:pages', dir, scope: CTX });
    fs.writeFileSync(path.join(dir, 'a.md'), '# Heading\n');

    let captured = '';
    r.subscribe(
      'pages:pages',
      {
        onChange: () => {
          // write-back injects an anchor, suppressing its own event
          r.suppress(CTX, 'pages:pages', 'a.md');
          fs.writeFileSync(path.join(dir, 'a.md'), '<!-- anchor: abc123 -->\n# Heading\n');
        },
        onUnlink: () => {},
      },
      { id: 'm06-anchor-injection', phase: 'write-back', scope: CTX },
    );
    r.subscribe(
      'pages:pages',
      {
        onChange: () => {
          captured = fs.readFileSync(path.join(dir, 'a.md'), 'utf-8');
        },
        onUnlink: () => {},
      },
      { id: 'm17-capture', phase: 'capture', after: ['write-back'], scope: CTX },
    );

    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(captured).toContain('<!-- anchor: abc123 -->');
  });

  it('write-back runs before the independent phases, which run before capture', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    // Registered in deliberately the wrong order.
    r.subscribe('pages:pages', recorder(log, 'cap'), { id: 'm17-capture', phase: 'capture', scope: CTX });
    r.subscribe('pages:pages', recorder(log, 'wb'), { id: 'm06-anchor', phase: 'write-back', scope: CTX });
    r.subscribe('pages:pages', recorder(log, 'reload'), { id: 'm33-reload', phase: 'reload', scope: CTX });
    r.subscribe('pages:pages', recorder(log, 'notify'), { id: 'm02-notify', phase: 'notification', scope: CTX });
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-index', phase: 'projection', scope: CTX });

    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['wb', 'proj', 'notify', 'reload', 'cap']);
  });

  it('[ac:ac-w-roocie-z-sectionindexed-true-link-i] `after: [m06-section-indexer]` is honoured within a phase', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    // M14 registered FIRST — order must come from `after`, not registration.
    r.subscribe('pages:pages', recorder(log, 'm14'), {
      id: 'm14-link-indexer',
      phase: 'projection',
      after: ['m06-section-indexer'],
      scope: CTX,
    });
    r.subscribe('pages:pages', recorder(log, 'm06'), { id: 'm06-section-indexer', phase: 'projection', scope: CTX });

    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['m06', 'm14']);
  });

  it('[ac:ac-w-roocie-bez-sectionindexed-link-indek] a missing predecessor counts as satisfied', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:notindexed', dir: tmp(), scope: CTX });
    const log: string[] = [];
    // The `sectionIndexed` gate means M06 never subscribed on this root.
    r.subscribe('pages:notindexed', recorder(log, 'm14'), {
      id: 'm14-link-indexer',
      phase: 'projection',
      after: ['m06-section-indexer'],
      scope: CTX,
    });
    await r.flush(CTX, 'pages:notindexed', 'a.md');
    expect(log).toEqual(['m14']);
  });

  it('[ac:ac-id-subskrypcji-kolidujace-z-nazwa-fazy] an id colliding with a phase name, or a forward `after`, is rejected', () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });

    expect(() =>
      r.subscribe('pages:pages', recorder([], 'x'), { id: 'capture', phase: 'projection', scope: CTX }),
    ).toThrow(/reserved phase name/);

    expect(() =>
      r.subscribe('pages:pages', recorder([], 'x'), {
        id: 'm02-early',
        phase: 'projection',
        after: ['capture'],
        scope: CTX,
      }),
    ).toThrow(/later phase 'capture'/);

    // Forward edge to a sibling id, in both registration orders.
    r.subscribe('pages:pages', recorder([], 'late'), { id: 'm17-capture', phase: 'capture', scope: CTX });
    expect(() =>
      r.subscribe('pages:pages', recorder([], 'x'), {
        id: 'm02-idx',
        phase: 'projection',
        after: ['m17-capture'],
        scope: CTX,
      }),
    ).toThrow(/later phase 'capture'/);

    const r2 = runtime();
    r2.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    r2.subscribe('pages:pages', recorder([], 'x'), {
      id: 'm02-idx',
      phase: 'projection',
      after: ['m17-capture'],
      scope: CTX,
    });
    expect(() =>
      r2.subscribe('pages:pages', recorder([], 'late'), { id: 'm17-capture', phase: 'capture', scope: CTX }),
    ).toThrow(/later phase 'capture'/);
  });

  it('rejects a duplicate subscription id on the same source', () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    r.subscribe('pages:pages', recorder([], 'a'), { id: 'm02-idx', phase: 'projection', scope: CTX });
    expect(() =>
      r.subscribe('pages:pages', recorder([], 'b'), { id: 'm02-idx', phase: 'projection', scope: CTX }),
    ).toThrow(/duplicate subscription id/);
  });

  it('[ac:ac-subskrybent-poznej-fazy-ktory-zastaje-p] a throwing subscriber does not abort the rest of the dispatch', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    r.subscribe(
      'pages:pages',
      {
        onChange: () => {
          throw new Error('ENOENT: file already deleted');
        },
        onUnlink: () => {},
      },
      { id: 'm06-boom', phase: 'projection', scope: CTX },
    );
    r.subscribe('pages:pages', recorder(log, 'survivor'), { id: 'm17-capture', phase: 'capture', scope: CTX });

    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['survivor']);
    spy.mockRestore();
  });

  it('applies the mechanical path filter per subscription', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'html'), {
      id: 'm30-html-preview',
      phase: 'notification',
      filter: '**/*.html',
      scope: CTX,
    });
    r.subscribe('pages:pages', recorder(log, 'md'), {
      id: 'm06-section-indexer',
      phase: 'projection',
      filter: '**/*.{md,mdx}',
      scope: CTX,
    });

    await r.flush(CTX, 'pages:pages', 'guide/intro.html');
    expect(log).toEqual(['html']);

    log.length = 0;
    await r.flush(CTX, 'pages:pages', 'guide/intro.md');
    expect(log).toEqual(['md']);
  });
});

describe('M40 — self-writes', () => {
  it('[ac:ac-zapis-poprzedzony-suppress-nie-wywol] a suppressed write runs no phase at all', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'capture'), { id: 'm17-capture', phase: 'capture', scope: CTX });

    r.suppress(CTX, 'pages:pages', 'a.md');
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual([]);
  });

  it('[ac:ac-zapis-serwera-poprzedzony-markorigin] a marked server write runs every phase with origin=server', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const origins: string[] = [];
    r.subscribe(
      'pages:pages',
      {
        onChange: (_s, _src, _p, origin) => {
          origins.push(origin);
        },
        onUnlink: () => {},
      },
      { id: 'm02-notify', phase: 'notification', scope: CTX },
    );

    r.markOrigin(CTX, 'pages:pages', 'a.md', 'user');
    expect(r.peekActor(CTX, 'pages:pages', 'a.md')).toBe('user');
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(origins).toEqual(['server']);
  });

  it('an unmarked change reports origin=external', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const origins: string[] = [];
    r.subscribe(
      'pages:pages',
      { onChange: (_s, _src, _p, o) => void origins.push(o), onUnlink: () => {} },
      { id: 'm02-notify', phase: 'notification', scope: CTX },
    );
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(origins).toEqual(['external']);
  });

  it('[ac:ac-origin-token-ani-suppress-projektu-a-nie] project A’s token never masks project B', async () => {
    const r = runtime();
    const other: WatchScope = 'context:p2';
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: other });

    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'B'), { id: 'm17-capture', phase: 'capture', scope: other });

    // Suppress the SAME relPath in project A only.
    r.suppress(CTX, 'pages:pages', 'shared.md');
    await r.flush(other, 'pages:pages', 'shared.md');
    expect(log).toEqual(['B']);
  });
});

describe('M40 — the second trigger and token lifetime', () => {
  it('runChain runs every phase despite a live suppress token, unlike flush', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-index', phase: 'projection', scope: CTX });

    // Arm 1: the primitive suppresses its own write and then drives the chain
    // itself. A chain that honoured the token would run nothing at all, which is
    // exactly why this cannot be `flush`.
    r.suppress(CTX, 'pages:pages', 'a.md', 'primitive');
    const res = await r.runChain(CTX, 'pages:pages', 'a.md', 'change', 'server');
    expect(log).toEqual(['proj']);
    expect(res.staleProjections).toEqual([]);
  });

  it('a primitive token survives its own chain, so the provider’s late echo is still swallowed', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-index', phase: 'projection', scope: CTX });

    r.suppress(CTX, 'pages:pages', 'a.md', 'primitive');
    await r.runChain(CTX, 'pages:pages', 'a.md', 'change', 'server');
    expect(log).toEqual(['proj']);

    // The echo arrives after the caller was already answered. Pre-0.2.76 the
    // dispatch cleared the token on its way out and this dispatched a second time.
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['proj']);
  });

  it('a token is not consumed by the first matching event — a write of zero bytes emits none', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-index', phase: 'projection', scope: CTX });

    r.suppress(CTX, 'pages:pages', 'a.md', 'primitive');
    // An atomic rename is reported once by one provider and as a PAIR by another.
    // A one-shot token would be eaten by the first and let the second through.
    await r.flush(CTX, 'pages:pages', 'a.md', 'unlink');
    await r.flush(CTX, 'pages:pages', 'a.md', 'add');
    expect(log).toEqual([]);
  });

  it('a chain-owned token is still cleared by the dispatch that encloses it', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    // Arm 2: a write-back inside a running chain, writing the chain's own file.
    r.subscribe(
      'pages:pages',
      { onChange: () => r.suppress(CTX, 'pages:pages', 'a.md'), onUnlink: () => {} },
      { id: 'm06-anchor', phase: 'write-back', scope: CTX },
    );
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-index', phase: 'projection', scope: CTX });

    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['proj']);
    // Nothing of it outlives the run: the next genuine edit still dispatches.
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['proj', 'proj']);
  });

  it('runChain carries the actor, so capture still has three values without markOrigin', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    let seen: string | undefined;
    r.subscribe(
      'pages:pages',
      {
        onChange: () => void (seen = r.peekActor(CTX, 'pages:pages', 'a.md')),
        onUnlink: () => {},
      },
      { id: 'm17-capture', phase: 'capture', scope: CTX },
    );
    await r.runChain(CTX, 'pages:pages', 'a.md', 'change', 'server', 'agent');
    expect(seen).toBe('agent');
  });

  it('a dispatch already in flight for the path cannot wipe the actor runChain was given', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    let release!: () => void;
    let enter!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered = new Promise<void>((resolve) => (enter = resolve));
    let first = true;
    let seen: string | undefined;
    r.subscribe(
      'pages:pages',
      {
        onChange: async () => {
          // The FIRST dispatch — an external edit, no actor — parks inside the
          // chain. Its `.finally` deletes the actor key on the way out, so the
          // second dispatch must not have stamped its actor before awaiting it.
          if (first) {
            first = false;
            enter();
            await gate;
            return;
          }
          seen = r.peekActor(CTX, 'pages:pages', 'a.md');
        },
        onUnlink: () => {},
      },
      { id: 'm17-capture', phase: 'capture', scope: CTX },
    );

    const external = r.runChain(CTX, 'pages:pages', 'a.md', 'change', 'external');
    await entered; // the first chain is genuinely in flight before the second starts
    const byAgent = r.runChain(CTX, 'pages:pages', 'a.md', 'change', 'server', 'agent');
    release();
    await Promise.all([external, byAgent]);
    expect(seen).toBe('agent');
  });

  it('exposes the running dispatch’s key, and nothing outside one', async () => {
    const r = runtime();
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    let inside: unknown;
    r.subscribe(
      'pages:pages',
      { onChange: () => void (inside = r.currentDispatch()), onUnlink: () => {} },
      { id: 'm06-index', phase: 'projection', scope: CTX },
    );
    expect(r.currentDispatch()).toBeUndefined();
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(inside).toEqual({ scope: CTX, source: 'pages:pages', relPath: 'a.md' });
    expect(r.currentDispatch()).toBeUndefined();
  });
});

describe('M40 — flush', () => {
  it('drives the chain with no fs provider at all (the harness property)', async () => {
    const r = runtime({ fsEvents: false });
    r.mountSource({ source: 'pages:pages', dir: tmp(), scope: CTX });
    const log: string[] = [];
    r.subscribe('pages:pages', recorder(log, 'proj'), { id: 'm06-idx', phase: 'projection', scope: CTX });
    await r.flush(CTX, 'pages:pages', 'a.md');
    expect(log).toEqual(['proj']);
  });

});
