import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { ChatService } from '../../../src/server/services/chat.js';

/**
 * M05 0.2.47 — `ChatThread.isLive` is structural, not derived from message rows.
 *
 * It has no column: `hydrateThread()` computes it per read from the injected
 * liveness predicate, which in production is `activeAdapters.has(threadId)`.
 * Because `ChatThreadMeta extends ChatThread` and the list projection spreads
 * `hydrateThread()`, the same field reaches both the detail endpoint and the list.
 */
describe('ChatThread.isLive', () => {
  let db: Database.Database;
  const live = new Set<string>();

  beforeEach(() => {
    db = createTestDb();
    live.clear();
  });
  afterEach(() => db.close());

  const service = () => new ChatService(db, (threadId) => live.has(threadId));

  it('[ac:ac-islive-odzwierciedla-zywa-ture-i-giei] mirrors the adapter registry on both the detail read and the list', () => {
    const chat = service();
    const running = chat.createThread('running');
    const idle = chat.createThread('idle');
    live.add(running.id);

    expect(chat.getThreadMeta(running.id)!.isLive).toBe(true);
    expect(chat.getThreadMeta(idle.id)!.isLive).toBe(false);

    const listed = Object.fromEntries(chat.listThreads().map((t) => [t.id, t.isLive]));
    expect(listed[running.id]).toBe(true);
    expect(listed[idle.id]).toBe(false);
  });

  it('[ac:ac-islive-odzwierciedla-zywa-ture-i-giei] is false for every thread after a server restart', () => {
    const chat = service();
    const t = chat.createThread('was running');
    live.add(t.id);
    expect(chat.getThreadMeta(t.id)!.isLive).toBe(true);

    // A restart takes `activeAdapters` — and with it every replay buffer — down
    // with the process. A fresh service must report `false` for everything, which
    // is what makes the client fall back to full history instead of a doomed join.
    live.clear();
    const afterRestart = new ChatService(db, (threadId) => live.has(threadId));
    expect(afterRestart.getThreadMeta(t.id)!.isLive).toBe(false);
    expect(afterRestart.listThreads().every((row) => row.isLive === false)).toBe(true);
  });

  it('defaults to false when no predicate is injected', () => {
    const chat = new ChatService(db);
    const t = chat.createThread('no registry');
    expect(chat.getThreadMeta(t.id)!.isLive).toBe(false);
  });
});
