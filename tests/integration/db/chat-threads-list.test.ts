import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { ChatService } from '../../../src/server/services/chat.js';

// P2: GET /api/threads is default-limited (last 20, updated_at DESC) and paginates
// via limit/offset. These exercise the ChatService projection directly.
describe('ChatService.listThreads pagination (P2)', () => {
  let db: Database.Database;
  let chat: ChatService;

  beforeEach(() => {
    db = createTestDb();
    chat = new ChatService(db);
    // 25 threads with strictly increasing updated_at, so DESC order is t24..t0.
    for (let i = 0; i < 25; i++) {
      const created = chat.createThread(`t${i}`);
      db.prepare(`UPDATE chat_thread SET updated_at = ? WHERE id = ?`).run(
        `2026-01-01 00:00:${String(i).padStart(2, '0')}`,
        created.id,
      );
    }
  });
  afterEach(() => db.close());

  it('defaults to 20 rows, newest first', () => {
    const page = chat.listThreads();
    expect(page).toHaveLength(20);
    expect(page[0].title).toBe('t24');
    expect(page[19].title).toBe('t5');
  });

  it('honors limit/offset with non-overlapping pages', () => {
    const p0 = chat.listThreads(10, 0);
    const p1 = chat.listThreads(10, 10);
    expect(p0).toHaveLength(10);
    expect(p1).toHaveLength(10);
    expect(p0[0].title).toBe('t24');
    expect(p1[0].title).toBe('t14');
    const firstIds = new Set(p0.map((t) => t.id));
    expect(p1.every((t) => !firstIds.has(t.id))).toBe(true);
  });

  it('returns a short final page (< limit) signalling no more rows', () => {
    const last = chat.listThreads(20, 20);
    expect(last).toHaveLength(5);
    expect(last[0].title).toBe('t4');
  });
});
