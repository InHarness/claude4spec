import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatchRuntime, type WatchScope, type WatchSubscriber } from './watcher.js';
import { RecordStore, RecordConflictError, RecordPathError } from './record-store.js';
import { markdownAdapter, jsonAdapter, type MarkdownRecord } from './record-adapters.js';

/**
 * M42 — the six steps, and the two properties that are only true because they
 * run under one lock.
 *
 * Driven with `fsEvents: false`: nothing here is about the file provider. The
 * primitive's contract is stated without reference to chokidar, and the cases
 * that genuinely need a provider live in `watcher.fs.test.ts`.
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];
const SOURCE = 'pages:pages';
const CTX: WatchScope = 'context:p1';

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m42-'));
  tmpDirs.push(d);
  return d;
}

function harness(): { store: RecordStore<MarkdownRecord>; runtime: FileWatchRuntime; dir: string } {
  const dir = tmp();
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(runtime);
  runtime.mountSource({ source: SOURCE, dir, scope: CTX });
  const store = new RecordStore<MarkdownRecord>({
    registrar: runtime.scoped(CTX),
    source: SOURCE,
    dir,
    adapter: markdownAdapter,
    validatePath: (relPath) => {
      if (!/\.mdx?$/.test(relPath)) throw new RecordPathError(`only .md / .mdx paths allowed: ${relPath}`);
    },
  });
  return { store, runtime, dir };
}

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('M42 — the write sequence', () => {
  it('runs the chain in-band and answers with the state the chain settled on', async () => {
    const { store, runtime, dir } = harness();
    // A write-back that rewrites the very file the chain is handling — anchor
    // injection, in miniature. Under the new phase order it runs FIRST, and the
    // answer must carry what IT left, not what the caller sent.
    const injector: WatchSubscriber = {
      onChange: async (_scope, _source, relPath) => {
        const raw = fs.readFileSync(path.join(dir, relPath), 'utf-8');
        if (raw.includes('injected')) return;
        await store.write(relPath, { raw: `${raw}\ninjected\n` });
      },
      onUnlink: () => {},
    };
    runtime.subscribe(SOURCE, injector, { id: 'm06-anchor-injection', phase: 'write-back', scope: CTX });

    const res = await store.write('a.md', { body: '# A\n' });
    expect(res.content).toContain('injected');
    expect(res.hash).toBe(markdownAdapter.hash(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')));
    // The point of returning content at all: the hash alone could not have told
    // the caller its own text is no longer what is on disk.
    expect(res.content).not.toBe('# A\n');
  });

  it('a write-back into the chain’s own file neither deadlocks nor starts a second chain', async () => {
    const { store, runtime, dir } = harness();
    const chains: string[] = [];
    runtime.subscribe(
      SOURCE,
      {
        onChange: async (_s, _src, relPath) => {
          const raw = fs.readFileSync(path.join(dir, relPath), 'utf-8');
          if (raw.includes('once')) return;
          await store.write(relPath, { raw: `${raw}once\n` });
        },
        onUnlink: () => {},
      },
      { id: 'wb', phase: 'write-back', scope: CTX },
    );
    runtime.subscribe(
      SOURCE,
      { onChange: (_s, _src, relPath) => void chains.push(relPath), onUnlink: () => {} },
      { id: 'cap', phase: 'capture', scope: CTX },
    );

    // Would hang if the nested write re-took the path mutex the outer write holds.
    await store.write('a.md', { body: 'x\n' });
    expect(chains).toEqual(['a.md']);
  });

  it('refuses a stale expectedHash, and reports the state that is actually there', async () => {
    const { store } = harness();
    const first = await store.write('a.md', { body: 'one\n' });
    await expect(store.write('a.md', { body: 'two\n' }, { expectedHash: 'stale' })).rejects.toThrow(
      RecordConflictError,
    );
    await expect(store.write('a.md', { body: 'two\n' }, { expectedHash: 'stale' })).rejects.toMatchObject({
      currentHash: first.hash,
      currentContent: 'one\n',
    });
    // The refusal is CLEAN: nothing was written.
    expect(store.readRaw('a.md')).toBe('one\n');
  });

  it('treats an absent file as no conflict — a write doubles as create-or-replace', async () => {
    const { store } = harness();
    const res = await store.write('new.md', { body: 'hi\n' }, { expectedHash: 'whatever' });
    expect(res.content).toBe('hi\n');
  });

  it('serializes two concurrent writes on one path, so the loser gets an ordinary conflict', async () => {
    const { store } = harness();
    const base = await store.write('a.md', { body: 'base\n' });

    // Both declare the SAME state. Serialized rather than refused: the second
    // waits for the first to fully settle and is then checked against what it
    // actually left — which is the intended outcome, not a lost update.
    const results = await Promise.allSettled([
      store.write('a.md', { body: 'first\n' }, { expectedHash: base.hash }),
      store.write('a.md', { body: 'second\n' }, { expectedHash: base.hash }),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RecordConflictError);
    // Whichever won, the file is one of the two writes whole — never interleaved.
    expect(['first\n', 'second\n']).toContain(store.readRaw('a.md'));
  });

  it('lets different paths in one source write in parallel', async () => {
    const { store } = harness();
    await Promise.all([store.write('a.md', { body: 'a\n' }), store.write('b.md', { body: 'b\n' })]);
    expect(store.readRaw('a.md')).toBe('a\n');
    expect(store.readRaw('b.md')).toBe('b\n');
  });

  it('refuses a path outside the source directory before serializing anything', async () => {
    const { store } = harness();
    await expect(store.write('../escape.md', { body: 'x' })).rejects.toThrow(RecordPathError);
    await expect(store.write('notes.txt', { body: 'x' })).rejects.toThrow(RecordPathError);
  });

  it('an adapter that throws leaves no trace at all — the one failure before the commit', async () => {
    const dir = tmp();
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtimes.push(runtime);
    runtime.mountSource({ source: SOURCE, dir, scope: CTX });
    const ran: string[] = [];
    runtime.subscribe(
      SOURCE,
      { onChange: () => void ran.push('cap'), onUnlink: () => {} },
      { id: 'cap', phase: 'capture', scope: CTX },
    );
    const store = new RecordStore<MarkdownRecord>({
      registrar: runtime.scoped(CTX),
      source: SOURCE,
      dir,
      adapter: {
        ...markdownAdapter,
        serialize: () => {
          throw new Error('nope');
        },
      },
    });
    fs.writeFileSync(path.join(dir, 'a.md'), 'before\n');

    await expect(store.write('a.md', { body: 'after\n' })).rejects.toThrow('nope');
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe('before\n');
    expect(ran).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'a.md.tmp'))).toBe(false);
  });

  it('a failed write hands its suppress token back, so the next genuine edit is not swallowed', async () => {
    const { store, runtime, dir } = harness();
    const seen: string[] = [];
    runtime.subscribe(
      SOURCE,
      { onChange: (_s, _src, p) => void seen.push(p), onUnlink: () => {} },
      { id: 'cap', phase: 'capture', scope: CTX },
    );
    // A directory where the file should be: the rename fails, the commit never lands.
    fs.mkdirSync(path.join(dir, 'a.md'));
    await expect(store.write('a.md', { body: 'x\n' })).rejects.toThrow();
    fs.rmSync(path.join(dir, 'a.md'), { recursive: true });

    // The watcher trigger must still see the next edit.
    await runtime.flush(CTX, SOURCE, 'a.md');
    expect(seen).toEqual(['a.md']);
  });
});

describe('M42 — the key is (scope, source, path), all three', () => {
  it('a write from another scope mid-dispatch runs its own chain instead of joining ours', async () => {
    // Two project contexts in ONE process, the same source name and the same
    // relative path — `pages:pages` / `index.md` exists in every context. The
    // re-entrancy shortcut reads a process-wide AsyncLocalStorage, so without
    // the scope in the comparison, B's write would silently take A's arm-2 path:
    // no chain, and a hash taken off pre-chain bytes.
    const a = harness();
    const other: WatchScope = 'context:p2';
    const dirB = tmp();
    a.runtime.mountSource({ source: SOURCE, dir: dirB, scope: other });
    const storeB = new RecordStore<MarkdownRecord>({
      registrar: a.runtime.scoped(other),
      source: SOURCE,
      dir: dirB,
      adapter: markdownAdapter,
    });

    let bChainRan = 0;
    a.runtime.subscribe(SOURCE, { onChange: () => void bChainRan++, onUnlink: () => {} }, { id: 'b-proj', phase: 'projection', scope: other });

    let fromInsideA: string | undefined;
    a.runtime.subscribe(
      SOURCE,
      {
        onChange: async () => {
          if (fromInsideA !== undefined) return;
          fromInsideA = (await storeB.write('index.md', { raw: 'from B\n' })).content;
        },
        onUnlink: () => {},
      },
      { id: 'a-proj', phase: 'projection', scope: CTX },
    );

    await a.store.write('index.md', { raw: 'from A\n' });
    expect(fromInsideA).toBe('from B\n');
    expect(bChainRan).toBe(1); // B got a real chain of its own, not A's
  });
});

describe('M42 — nothing past the commit point may fail the write', () => {
  it('a settled file the adapter cannot parse still reports success and its bytes', async () => {
    const dir = tmp();
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtimes.push(runtime);
    runtime.mountSource({ source: SOURCE, dir, scope: CTX });
    // Serializes fine, cannot read back — gray-matter on a historic snapshot
    // whose frontmatter it chokes on, which is exactly what `restorePage` feeds
    // it. The file IS written and the chain HAS run: reporting a failure here
    // would tell the caller a completed restore had failed.
    const store = new RecordStore<MarkdownRecord>({
      registrar: runtime.scoped(CTX),
      source: SOURCE,
      dir,
      adapter: {
        ...markdownAdapter,
        deserialize: () => {
          throw new Error('unparseable frontmatter');
        },
      },
    });

    const res = await store.write('a.md', { raw: '---\nbad: [\n---\nbody\n' });
    expect(res.content).toBe('---\nbad: [\n---\nbody\n');
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe(res.content);
  });

  it('a delete issued from inside the chain for that same file does not deadlock', async () => {
    const { store, runtime, dir } = harness();
    let removed: boolean | undefined;
    runtime.subscribe(
      SOURCE,
      {
        onChange: async (_scope, _source, relPath) => {
          if (removed !== undefined) return;
          // `write` has the arm-2 shortcut; `remove` must have it too, or this
          // awaits the path mutex its own enclosing write still holds — forever.
          removed = await store.remove(relPath);
        },
        onUnlink: () => {},
      },
      { id: 'reaper', phase: 'write-back', scope: CTX },
    );

    await store.write('a.md', { raw: 'gone in a moment\n' });
    expect(removed).toBe(true);
    expect(fs.existsSync(path.join(dir, 'a.md'))).toBe(false);
  });
});

describe('M42 — phase error classes', () => {
  it('retries a failed projection once, then reports it stale and still succeeds', async () => {
    const { store, runtime } = harness();
    let calls = 0;
    runtime.subscribe(
      SOURCE,
      {
        onChange: () => {
          calls++;
          throw new Error('index is down');
        },
        onUnlink: () => {},
      },
      { id: 'm06-section-indexer', phase: 'projection', scope: CTX },
    );

    const res = await store.write('a.md', { body: 'x\n' });
    // Success WITH A WARNING — never a failure. The commit point is the file.
    expect(res.content).toBe('x\n');
    expect(res.staleProjections).toEqual(['m06-section-indexer']);
    expect(calls).toBe(2);
  });

  it('a projection that recovers on the retry is not reported stale', async () => {
    const { store, runtime } = harness();
    let calls = 0;
    runtime.subscribe(
      SOURCE,
      {
        onChange: () => {
          if (++calls === 1) throw new Error('transient');
        },
        onUnlink: () => {},
      },
      { id: 'm06-section-indexer', phase: 'projection', scope: CTX },
    );
    const res = await store.write('a.md', { body: 'x\n' });
    expect(res.staleProjections).toEqual([]);
    expect(calls).toBe(2);
  });

  it('an incidental phase is logged and retried NEVER, and changes no result', async () => {
    const { store, runtime } = harness();
    let calls = 0;
    runtime.subscribe(
      SOURCE,
      {
        onChange: () => {
          calls++;
          throw new Error('no version log today');
        },
        onUnlink: () => {},
      },
      { id: 'm17-capture', phase: 'capture', scope: CTX },
    );
    const res = await store.write('a.md', { body: 'x\n' });
    expect(res.staleProjections).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe('M42 — the json adapter', () => {
  it('is byte-stable under key reordering, so an unchanged record round-trips identically', () => {
    const a = jsonAdapter.serialize({ b: 1, a: { d: 2, c: 3 } });
    const b = jsonAdapter.serialize({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
    expect(jsonAdapter.hash(a)).toBe(jsonAdapter.hash(b));
  });
});

describe('M42 — the markdown adapter', () => {
  it('writes a bare body when there is no frontmatter, and hashes the whole file', () => {
    expect(markdownAdapter.serialize({ body: '# A\n' })).toBe('# A\n');
    expect(markdownAdapter.serialize({ body: '# A\n', frontmatter: {} })).toBe('# A\n');
    const withFm = markdownAdapter.serialize({ body: '# A\n', frontmatter: { title: 'A' } });
    expect(withFm.startsWith('---')).toBe(true);
    // Over frontmatter + body together — the value `expectedHash` is compared against.
    expect(markdownAdapter.hash(withFm)).not.toBe(markdownAdapter.hash('# A\n'));
  });

  it('passes `raw` through untouched, which is what byte-for-byte restore needs', () => {
    const bytes = '---\nz: 1\na: 2\n---\nbody';
    expect(markdownAdapter.serialize({ raw: bytes })).toBe(bytes);
  });
});
