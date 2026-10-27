import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { RecordConflictError, type RecordStore, type RecordWriteOptions } from './record-store.js';

/**
 * M42 — a multi-file operation (2.1.57, `gg7sxih6`).
 *
 * Atomicity across files does not exist: an operation writing N files is N
 * commits, N chains and N entries in the version log. What this module adds is
 * the two rules every such operation obeys, ONCE, so callers point here and do
 * not repeat them:
 *
 *  1. **One identifier in the history.** Every `file_version` row written while
 *     the operation runs — its rollback rows included — carries the same
 *     `operation_id`. The id rides an `AsyncLocalStorage`, not a parameter: the
 *     rows are written by the `capture` phase of each file's chain (or, for a
 *     source that writes with `chain: false`, by its owner right after the
 *     write), both on the operation's own async path. The single INSERT site
 *     (`FileVersionService.recordVersion`) reads it from there, so no write
 *     signature, no watcher tuple and no subscriber had to learn a new argument.
 *  2. **Rollback on a partial failure.** When any step throws, the files the
 *     operation already wrote are put back to their original content — by
 *     further writes through the primitive, under the same id — and the
 *     operation fails with {@link MultiFileOperationError}. The rollback is
 *     best effort, NOT a transaction: each undo declares the state the
 *     operation itself left as its `expectedHash`, so a file somebody else
 *     changed in the meantime reports its own conflict and stays in the state
 *     that conflict shows. It is listed in `unrestored`, never overwritten.
 */

// The operation itself, not just its id: a nested call must reuse the outer
// handle (one journal), so only the outermost call rolls back.
const operationStore = new AsyncLocalStorage<MultiFileOperation>();

/** The id of the multi-file operation running on this async path, if any. */
export function currentOperationId(): string | undefined {
  return operationStore.getStore()?.id;
}

/** A file the rollback could not put back, and why (usually a `RecordConflictError`). */
export interface UnrestoredFile {
  relPath: string;
  reason: unknown;
}

/** The error a multi-file operation fails with, after its rollback has run. */
export class MultiFileOperationError extends Error {
  constructor(
    readonly operationId: string,
    cause: unknown,
    /** Files put back to their original content, in rollback order. */
    readonly restored: string[],
    /** Files left as the conflicting state shows them. */
    readonly unrestored: UnrestoredFile[],
  ) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(
      unrestored.length === 0
        ? `multi-file operation failed and was rolled back: ${why}`
        : `multi-file operation failed; ${unrestored.length} file(s) could not be restored: ${why}`,
      { cause },
    );
    this.name = 'MultiFileOperationError';
  }
}

/** What one completed step changed, and how to undo it. */
type JournalEntry =
  | { kind: 'write'; store: RecordStore<unknown>; relPath: string; before: string | null; afterHash: string; opts: RecordWriteOptions }
  | { kind: 'move'; store: RecordStore<unknown>; from: string; to: string; afterHash: string; opts: RecordWriteOptions };

/**
 * The handle a caller performs its steps through. Each step is an ordinary
 * primitive call; the handle only remembers what it overwrote, so the rollback
 * knows what to put back. A step that refuses (steps 1–2 of the primitive)
 * wrote nothing and is not journalled.
 */
export class MultiFileOperation {
  private readonly journal: JournalEntry[] = [];

  constructor(readonly id: string) {}

  async write<T>(store: RecordStore<T>, relPath: string, record: T, opts: RecordWriteOptions = {}) {
    const before = store.readRaw(relPath);
    const res = await store.write(relPath, record, opts);
    this.journal.push({ kind: 'write', store: store as RecordStore<unknown>, relPath, before, afterHash: res.hash, opts });
    return res;
  }

  async move<T>(store: RecordStore<T>, from: string, to: string, opts: RecordWriteOptions = {}) {
    const res = await store.move(from, to, opts);
    this.journal.push({ kind: 'move', store: store as RecordStore<unknown>, from, to, afterHash: res.hash, opts });
    return res;
  }

  /** Undo every completed step, newest first. Never throws: each file answers for itself. */
  async rollback(): Promise<{ restored: string[]; unrestored: UnrestoredFile[] }> {
    const restored: string[] = [];
    const unrestored: UnrestoredFile[] = [];
    for (const entry of this.journal.splice(0).reverse()) {
      const relPath = entry.kind === 'move' ? entry.from : entry.relPath;
      // The undo is a write like any other — same actor, same origin, same chain.
      const opts: RecordWriteOptions = { actor: entry.opts.actor, origin: entry.opts.origin, chain: entry.opts.chain };
      try {
        if (entry.kind === 'write') {
          if (entry.before !== null) {
            await entry.store.restore(entry.relPath, entry.before, { ...opts, expectedHash: entry.afterHash });
          } else {
            // The operation CREATED the file: undoing it is a delete — unless
            // somebody changed it since, which is their state to keep.
            const now = entry.store.readRaw(entry.relPath);
            if (now !== null) {
              const nowHash = entry.store.adapter.hash(now);
              if (nowHash !== entry.afterHash) throw new RecordConflictError(nowHash, now);
            }
            await entry.store.remove(entry.relPath, opts);
          }
        } else {
          await entry.store.move(entry.to, entry.from, { ...opts, expectedHash: entry.afterHash });
        }
        restored.push(relPath);
      } catch (reason) {
        unrestored.push({ relPath, reason });
      }
    }
    return { restored, unrestored };
  }
}

/**
 * Run `fn` as ONE multi-file operation: every version row it writes carries one
 * `operation_id`, and if it throws, what it already wrote is rolled back and a
 * {@link MultiFileOperationError} is thrown instead. A call nested inside a
 * running operation joins it: it gets the outer handle — same id, same journal —
 * and a failure inside it propagates untouched. Only the outermost call rolls
 * back (everything the operation wrote, the nested steps included) and wraps
 * the error, once.
 */
export async function runMultiFileOperation<R>(fn: (op: MultiFileOperation) => Promise<R>): Promise<R> {
  const outer = operationStore.getStore();
  if (outer) return await fn(outer);
  const op = new MultiFileOperation(crypto.randomUUID());
  return await operationStore.run(op, async () => {
    try {
      return await fn(op);
    } catch (cause) {
      const { restored, unrestored } = await op.rollback();
      throw new MultiFileOperationError(op.id, cause, restored, unrestored);
    }
  });
}
