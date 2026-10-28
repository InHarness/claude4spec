import fs from 'node:fs';
import path from 'node:path';

const LOCK_STALE_MS = 5_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * M31: advisory lock over one file shared by N processes — a `wx` lock file
 * with the holder's pid, reaped after ~5 s as stale. One primitive for both
 * files a record can land in: the registry (`~/.claude4spec/workspaces.json`)
 * and a home's `workspace.json` (lock file in `<home>/.claude4spec/local/`).
 */
export function withAdvisoryLock<T>(lockPath: string, fn: () => T): T {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  acquire(lockPath);
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* already released / stale-reaped by a peer */
    }
  }
}

function acquire(lockPath: string): void {
  const deadline = Date.now() + LOCK_STALE_MS * 2;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // lock vanished between open and stat — retry immediately
      }
      if (Date.now() > deadline) {
        throw new Error(`advisory lock held too long: ${lockPath}`);
      }
      sleepSync(25);
    }
  }
}

/** Atomic whole-file write (tmp + rename) — shared by both lock owners. */
export function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
