import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FileWatchRuntime, type WatchScope } from './watcher.js';
import { RecordStore, RecordConflictError } from './record-store.js';
import { markdownAdapter, type MarkdownRecord } from './record-adapters.js';
import { runMultiFileOperation, MultiFileOperationError, currentOperationId } from './multi-file-operation.js';
import { runMigrations } from '../db/migrate.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { FileVersionCapture } from '../services/file-version-capture.js';
import { MarkdownFileStore } from '../services/markdown-file-store.js';

/**
 * M42 `gg7sxih6` (2.1.57) — the two rules of a multi-file operation, driven
 * end to end through the primitive and M17's real `capture` phase: the
 * `file_version` rows are the observable.
 */

const SOURCE = 'pages:pages';
const CTX: WatchScope = 'context:p1';
const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];
const dbs: Database.Database[] = [];

function harness() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m42-op-'));
  tmpDirs.push(cwd);
  const dir = path.join(cwd, 'pages');
  fs.mkdirSync(dir);
  const db = new Database(':memory:');
  dbs.push(db);
  runMigrations(db);
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(runtime);
  runtime.mountSource({ source: SOURCE, dir, scope: CTX });
  const serializer = new FileSerializer(new MarkdownFileStore({ cwd, dir: 'pages', rootId: 'pages' }));
  const capture = new FileVersionCapture(new FileVersionService(db, serializer), new Map([['pages', serializer]]), () => undefined);
  runtime.subscribe(SOURCE, capture, { id: 'm17-capture', phase: 'capture', scope: CTX });
  const store = new RecordStore<MarkdownRecord>({ registrar: runtime.scoped(CTX), source: SOURCE, dir, adapter: markdownAdapter });
  const rows = (relPath?: string) =>
    db
      .prepare(
        `SELECT path, version, op, operation_id, json_extract(data, '$.content') AS content
         FROM file_version ${relPath ? 'WHERE path = ?' : ''} ORDER BY id`,
      )
      .all(...(relPath ? [relPath] : [])) as Array<{
      path: string;
      version: number;
      op: string;
      operation_id: string | null;
      content: string;
    }>;
  return { store, dir, rows };
}

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of dbs.splice(0)) d.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('M42 — a multi-file operation', () => {
  it('[section:gg7sxih6] every file_version row of one multi-file operation carries the same operation_id; a single-file write carries NULL', async () => {
    const { store, rows } = harness();
    await store.write('solo.md', { body: 'alone\n' });

    const first = await runMultiFileOperation(async (op) => {
      await op.write(store, 'a.md', { body: 'A\n' });
      await op.write(store, 'b.md', { body: 'B\n' });
      return op.id;
    });
    const second = await runMultiFileOperation(async (op) => {
      await op.write(store, 'a.md', { body: 'A2\n' });
      return op.id;
    });

    expect(rows('solo.md').map((r) => r.operation_id)).toEqual([null]);
    expect(rows('b.md').map((r) => r.operation_id)).toEqual([first]);
    expect(rows('a.md').map((r) => r.operation_id)).toEqual([first, second]);
    expect(first).toEqual(expect.any(String));
    // Two operations are two identifiers, and the id does not outlive its operation.
    expect(second).not.toBe(first);
    expect(currentOperationId()).toBeUndefined();
  });

  it('[section:gg7sxih6] a failing file write restores the files already written through the primitive, under the same operation_id, and the operation returns an error', async () => {
    const { store, dir, rows } = harness();
    // Frontmatter in a non-canonical key order: the restore must put back the
    // exact bytes, not a re-serialization of them.
    const originalA = '---\nzeta: 1\nalpha: 2\n---\nA0\n';
    await store.write('a.md', { raw: originalA });
    await store.write('b.md', { body: 'B0\n' });
    await store.write('c.md', { body: 'C0\n' });

    let opId: string | undefined;
    const failed = runMultiFileOperation(async (op) => {
      opId = op.id;
      await op.write(store, 'a.md', { body: 'A1\n' });
      await op.move(store, 'b.md', 'moved/b.md');
      await op.write(store, 'new.md', { body: 'N1\n' });
      // The N-th file refuses: c.md is not in the state the operation declared.
      await op.write(store, 'c.md', { body: 'C1\n' }, { expectedHash: 'stale' });
    });

    const err = await failed.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultiFileOperationError);
    const opErr = err as MultiFileOperationError;
    expect(opErr.operationId).toBe(opId);
    expect(opErr.cause).toBeInstanceOf(RecordConflictError);
    expect(opErr.unrestored).toEqual([]);
    // Newest first.
    expect(opErr.restored).toEqual(['new.md', 'b.md', 'a.md']);

    // Every file is back to its original content, byte for byte.
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe(originalA);
    expect(fs.readFileSync(path.join(dir, 'b.md'), 'utf-8')).toBe('B0\n');
    expect(fs.existsSync(path.join(dir, 'moved/b.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'new.md'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'c.md'), 'utf-8')).toBe('C0\n');

    // The rollback went through the primitive: it left version rows, and they
    // carry the operation's id like the rows of the forward writes.
    expect(rows('a.md').map((r) => [r.op, r.content, r.operation_id])).toEqual([
      ['create', originalA, null],
      ['update', 'A1\n', opId],
      ['update', originalA, opId],
    ]);
    expect(rows('new.md').map((r) => [r.op, r.operation_id])).toEqual([
      ['create', opId],
      ['delete', opId],
    ]);
    expect(rows('moved/b.md').map((r) => [r.op, r.operation_id])).toEqual([
      ['create', opId],
      ['delete', opId],
    ]);
    expect(rows('b.md').map((r) => [r.op, r.operation_id])).toEqual([
      ['create', null],
      ['delete', opId],
      ['update', opId],
    ]);
    // The refused write left nothing.
    expect(rows('c.md').map((r) => r.operation_id)).toEqual([null]);
  });

  it('[section:gg7sxih6] the rollback is best effort, not a transaction: a file changed meanwhile by someone else reports its own conflict and stays as that conflict shows', async () => {
    const { store, dir } = harness();
    await store.write('a.md', { body: 'A0\n' });
    await store.write('b.md', { body: 'B0\n' });

    const err = await runMultiFileOperation(async (op) => {
      await op.write(store, 'a.md', { body: 'A1\n' });
      await op.write(store, 'b.md', { body: 'B1\n' });
      // Somebody else — an editor outside the app — changes a.md in between.
      fs.writeFileSync(path.join(dir, 'a.md'), 'theirs\n');
      throw new Error('the third file failed');
    }).then(
      () => undefined,
      (e: unknown) => e as MultiFileOperationError,
    );

    expect(err).toBeInstanceOf(MultiFileOperationError);
    expect((err!.cause as Error).message).toBe('the third file failed');
    expect(err!.restored).toEqual(['b.md']);
    expect(err!.unrestored.map((u) => u.relPath)).toEqual(['a.md']);
    expect(err!.unrestored[0]!.reason).toBeInstanceOf(RecordConflictError);
    expect((err!.unrestored[0]!.reason as RecordConflictError).currentContent).toBe('theirs\n');
    // Their state stays; ours is rolled back.
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe('theirs\n');
    expect(fs.readFileSync(path.join(dir, 'b.md'), 'utf-8')).toBe('B0\n');
  });

  it('[section:gg7sxih6] a nested operation joins the outer one: when the outer fails after the nested one succeeded, the nested writes are rolled back too, under the one id', async () => {
    const { store, dir, rows } = harness();
    await store.write('a.md', { body: 'A0\n' });
    await store.write('b.md', { body: 'B0\n' });

    let outerId: string | undefined;
    let innerId: string | undefined;
    const err = await runMultiFileOperation(async (op) => {
      outerId = op.id;
      await op.write(store, 'a.md', { body: 'A1\n' });
      await runMultiFileOperation(async (inner) => {
        innerId = inner.id;
        await inner.write(store, 'b.md', { body: 'B1\n' });
        await inner.write(store, 'nested-new.md', { body: 'N1\n' });
      });
      throw new Error('the outer step failed after the nested one');
    }).then(
      () => undefined,
      (e: unknown) => e as MultiFileOperationError,
    );

    expect(innerId).toBe(outerId);
    expect(err).toBeInstanceOf(MultiFileOperationError);
    expect(err!.operationId).toBe(outerId);
    expect((err!.cause as Error).message).toBe('the outer step failed after the nested one');
    expect(err!.unrestored).toEqual([]);
    // One journal: the nested steps are undone with the outer ones, newest first.
    expect(err!.restored).toEqual(['nested-new.md', 'b.md', 'a.md']);
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe('A0\n');
    expect(fs.readFileSync(path.join(dir, 'b.md'), 'utf-8')).toBe('B0\n');
    expect(fs.existsSync(path.join(dir, 'nested-new.md'))).toBe(false);
    expect(rows('b.md').map((r) => [r.op, r.content, r.operation_id])).toEqual([
      ['create', 'B0\n', null],
      ['update', 'B1\n', outerId],
      ['update', 'B0\n', outerId],
    ]);
    expect(rows('nested-new.md').map((r) => [r.op, r.operation_id])).toEqual([
      ['create', outerId],
      ['delete', outerId],
    ]);
  });

  it('[section:gg7sxih6] a failing nested operation does not roll back on its own: the error propagates, only the outermost call rolls back everything and wraps it once', async () => {
    const { store, dir, rows } = harness();
    await store.write('a.md', { body: 'A0\n' });
    await store.write('b.md', { body: 'B0\n' });

    let outerId: string | undefined;
    let seenInOuter: unknown;
    const err = await runMultiFileOperation(async (op) => {
      outerId = op.id;
      await op.write(store, 'a.md', { body: 'A1\n' });
      try {
        await runMultiFileOperation(async (inner) => {
          await inner.write(store, 'b.md', { body: 'B1\n' });
          throw new Error('the nested step failed');
        });
      } catch (e) {
        seenInOuter = e;
        // Nothing was rolled back yet: the nested call left that to the outer one.
        expect(fs.readFileSync(path.join(dir, 'b.md'), 'utf-8')).toBe('B1\n');
        throw e;
      }
    }).then(
      () => undefined,
      (e: unknown) => e as MultiFileOperationError,
    );

    // The nested call rethrew the original error, not a wrapped one.
    expect(seenInOuter).not.toBeInstanceOf(MultiFileOperationError);
    expect((seenInOuter as Error).message).toBe('the nested step failed');
    // The outermost call wrapped it exactly once.
    expect(err).toBeInstanceOf(MultiFileOperationError);
    expect(err!.operationId).toBe(outerId);
    expect(err!.cause).toBe(seenInOuter);
    expect(err!.cause).not.toBeInstanceOf(MultiFileOperationError);
    expect(err!.restored).toEqual(['b.md', 'a.md']);
    expect(err!.unrestored).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe('A0\n');
    expect(fs.readFileSync(path.join(dir, 'b.md'), 'utf-8')).toBe('B0\n');
    // One rollback, not two: b.md has exactly one undo row.
    expect(rows('b.md').map((r) => [r.op, r.content, r.operation_id])).toEqual([
      ['create', 'B0\n', null],
      ['update', 'B1\n', outerId],
      ['update', 'B0\n', outerId],
    ]);
    expect(currentOperationId()).toBeUndefined();
  });
});
