import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './index.js';
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
