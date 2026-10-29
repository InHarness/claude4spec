import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirWatch, type DirWatchEvent } from './dir-watch.js';
import { isExcludedSubtree } from './watch-ignore.js';

/**
 * M40 2.1.60 (`vfyffo9a`) — the fs provider of a mount, against a real
 * filesystem: the whole subtree is observed, directory events expand into
 * per-file events, files are reported once settled, owner-declared exclusions
 * are dropped. Real system watches: every provider is closed in `afterEach`.
 */

const tmpDirs: string[] = [];
const watches: DirWatch[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m40-dw-'));
  tmpDirs.push(d);
  return d;
}

function watch(dir: string, exclude?: (rel: string) => boolean): string[] {
  const log: string[] = [];
  watches.push(
    new DirWatch({
      dir,
      exclude,
      onEvent: (event: DirWatchEvent, rel: string) => void log.push(`${event}:${rel}`),
      onError: (err) => {
        throw err;
      },
    }),
  );
  return log;
}

async function until(cond: () => boolean, timeoutMs = 4000, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rewrite a probe until the provider reports it — it is live and has listed the tree. */
async function waitLive(dir: string, log: string[]): Promise<void> {
  const probe = path.join(dir, 'probe.md');
  let live = false;
  for (let n = 0; n < 10 && !live; n++) {
    fs.writeFileSync(probe, `probe ${n}\n`);
    live = await until(() => log.some((e) => e.endsWith(':probe.md')), 1000);
  }
  expect(live).toBe(true);
  await sleep(200); // let a late probe echo pass
  log.length = 0;
}

afterEach(() => {
  for (const w of watches.splice(0)) w.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('M40 2.1.60 — the mount observes its whole subtree', () => {
  it('[ac:ac-katalog-z-plikami-przeniesiony-do-obs] a dir with files moved into the observed root emits `add` for each of its files', async () => {
    const dir = tmp();
    const outside = tmp();
    fs.mkdirSync(path.join(outside, 'pkg', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'pkg', 'a.md'), 'a\n');
    fs.writeFileSync(path.join(outside, 'pkg', 'nested', 'b.md'), 'b\n');
    const log = watch(dir);
    await waitLive(dir, log);

    fs.renameSync(path.join(outside, 'pkg'), path.join(dir, 'pkg'));

    expect(await until(() => log.length >= 2)).toBe(true);
    await sleep(300); // nothing else may follow
    expect([...log].sort()).toEqual(['add:pkg/a.md', 'add:pkg/nested/b.md']);
  });

  it('[ac:ac-katalog-z-plikami-przeniesiony-poza-o] a dir with files moved out of the observed root emits `unlink` for each of its files', async () => {
    const dir = tmp();
    const outside = tmp();
    fs.mkdirSync(path.join(dir, 'pkg', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pkg', 'a.md'), 'a\n');
    fs.writeFileSync(path.join(dir, 'pkg', 'nested', 'b.md'), 'b\n');
    const log = watch(dir);
    await waitLive(dir, log);

    fs.renameSync(path.join(dir, 'pkg'), path.join(outside, 'pkg'));

    expect(await until(() => log.length >= 2)).toBe(true);
    await sleep(300);
    expect([...log].sort()).toEqual(['unlink:pkg/a.md', 'unlink:pkg/nested/b.md']);

    // A file written into the moved-out dir is no longer observed.
    fs.writeFileSync(path.join(outside, 'pkg', 'c.md'), 'c\n');
    await sleep(400);
    expect(log.some((e) => e.includes('c.md'))).toBe(false);
  });

  it('[ac:ac-plik-utworzony-w-nowym-podkatalogu-ob] a file created in a new subdir of the observed root emits `add` without remounting the source', async () => {
    const dir = tmp();
    const log = watch(dir); // the one and only provider of this mount
    await waitLive(dir, log);

    fs.mkdirSync(path.join(dir, 'fresh', 'deeper'), { recursive: true });
    await sleep(200); // the new dirs are seen first, as their own event
    fs.writeFileSync(path.join(dir, 'fresh', 'deeper', 'x.md'), 'x\n');

    expect(await until(() => log.includes('add:fresh/deeper/x.md'))).toBe(true);
    // The same provider keeps observing the new dir: a later file there is reported too.
    fs.writeFileSync(path.join(dir, 'fresh', 'y.md'), 'y\n');
    expect(await until(() => log.includes('add:fresh/y.md'))).toBe(true);
  });

  it('[section:vfyffo9a] a file being written is reported once, after it has settled', async () => {
    const dir = tmp();
    const sizes: number[] = [];
    const file = path.join(dir, 'big.md');
    const log: string[] = [];
    watches.push(
      new DirWatch({
        dir,
        onEvent: (event, rel) => {
          log.push(`${event}:${rel}`);
          if (rel === 'big.md') sizes.push(fs.statSync(file).size);
        },
        onError: (err) => {
          throw err;
        },
      }),
    );
    await waitLive(dir, log);

    const fd = fs.openSync(file, 'w');
    for (let i = 0; i < 5; i++) {
      fs.writeSync(fd, 'x'.repeat(1000));
      await sleep(30); // well inside the settle window: every chunk re-arms it
    }
    fs.closeSync(fd);

    expect(await until(() => log.includes('add:big.md'))).toBe(true);
    await sleep(300);
    expect(log.filter((e) => e.endsWith(':big.md'))).toEqual(['add:big.md']);
    expect(sizes).toEqual([5000]);
  });

  it('[section:vfyffo9a] subtrees the owner excludes at mount produce no event', async () => {
    const dir = tmp();
    const log = watch(dir, isExcludedSubtree);
    await waitLive(dir, log);

    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'x\n');
    fs.mkdirSync(path.join(dir, '.hidden'));
    fs.writeFileSync(path.join(dir, '.hidden', 'y.md'), 'y\n');
    fs.writeFileSync(path.join(dir, '.page.md.tmp'), 'tmp\n');
    fs.writeFileSync(path.join(dir, 'kept.md'), 'kept\n');

    expect(await until(() => log.includes('add:kept.md'))).toBe(true);
    await sleep(300);
    expect(log).toEqual(['add:kept.md']);
  });
});
