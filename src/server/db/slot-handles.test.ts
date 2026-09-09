import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forgetDbSlot, openDb } from './index.js';
import type { WorkspaceRecord } from '../workspace/types.js';

/**
 * M41 — `openDb` is idempotent per slot key.
 *
 * The contract says two requests for the same `(workspace, project-id)` get the
 * SAME handle. It used to open a fresh better-sqlite3 connection every call, so
 * a retired context and its replacement held two uncoordinated connections to
 * one file. The refcount is what makes the shared handle safe to hand out
 * twice: `invalidate` is fire-and-forget, so predecessor and successor overlap
 * on one slot key by design, and whoever leaves first must not close the file
 * under the one still using it.
 */
describe('M41 openDb — one handle per slot, refcounted', () => {
  const roots: string[] = [];

  const ws = { name: 'ws-test', mode: 'dev', defaultPort: 4123, projects: [] } as unknown as WorkspaceRecord;

  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });

  const withHome = <T,>(fn: () => T): T => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-slot-'));
    roots.push(root);
    const prevHome = process.env.HOME;
    const prevProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    try {
      return fn();
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevProfile;
    }
  };

  it('hands the same underlying handle to two callers for one key', () => {
    withHome(() => {
      const a = openDb(ws, 'proj-1');
      const b = openDb(ws, 'proj-1');
      try {
        expect(b.handle).toBe(a.handle);
      } finally {
        a.close();
        b.close();
      }
    });
  });

  it('keeps the file open until the LAST owner leaves', () => {
    withHome(() => {
      const first = openDb(ws, 'proj-1');
      const second = openDb(ws, 'proj-1');

      // The retired context releases while its successor is still serving.
      first.close();
      expect(second.handle.open).toBe(true);
      // …and the successor can still use it, which is the whole point.
      expect(() => second.handle.pragma('user_version')).not.toThrow();

      second.close();
      expect(second.handle.open).toBe(false);
    });
  });

  it('opens a fresh handle after the slot was fully released', () => {
    withHome(() => {
      const first = openDb(ws, 'proj-1');
      const firstHandle = first.handle;
      first.close();

      const second = openDb(ws, 'proj-1');
      try {
        expect(second.handle).not.toBe(firstHandle);
        expect(second.handle.open).toBe(true);
      } finally {
        second.close();
      }
    });
  });

  it('does not confuse two different projects', () => {
    withHome(() => {
      const a = openDb(ws, 'proj-1');
      const b = openDb(ws, 'proj-2');
      try {
        expect(b.handle).not.toBe(a.handle);
      } finally {
        a.close();
        b.close();
      }
    });
  });

  /**
   * The purge path deletes the slot DIRECTORY. Because the map is keyed by
   * path, an entry that outlives the file would hand the next context that
   * registers this cwd a handle onto the unlinked inode — the project would
   * boot on a ghost database and every write would land somewhere unreachable
   * by name. Purge therefore forgets the key explicitly.
   */
  it('forgets a purged slot so the next open is a fresh file, not the deleted inode', () => {
    withHome(() => {
      // A reference the purge does not own — a retired context mid-dispose.
      const stillHeld = openDb(ws, 'proj-1');
      try {
        forgetDbSlot(ws, 'proj-1');

        const reopened = openDb(ws, 'proj-1');
        try {
          expect(reopened.handle).not.toBe(stillHeld.handle);
        } finally {
          reopened.close();
        }
      } finally {
        stillHeld.close();
      }
    });
  });

  it('leaves a still-held handle usable after its slot is forgotten', () => {
    withHome(() => {
      const held = openDb(ws, 'proj-1');
      try {
        // Forgetting is not closing: an in-flight read must not fail mid-statement.
        forgetDbSlot(ws, 'proj-1');
        expect(held.handle.open).toBe(true);
      } finally {
        held.close();
      }
    });
  });

  it('ignores a double close from one owner, so it cannot drop another owner reference', () => {
    withHome(() => {
      const a = openDb(ws, 'proj-1');
      const b = openDb(ws, 'proj-1');

      a.close();
      a.close(); // a context disposed twice must not evict b's reference
      expect(b.handle.open).toBe(true);

      b.close();
      expect(b.handle.open).toBe(false);
    });
  });
});
