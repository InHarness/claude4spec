import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { ChatService } from '../../../src/server/services/chat.js';
import { chatRouter } from '../../../src/server/routes/chat.js';
import { errorHandler } from '../../../src/server/routes/errors.js';
import type { ActiveAdapter, AgentTurnDeps } from '../../../src/server/routes/agent-turn.js';

/**
 * 0.2.13 — `POST /api/chat/abort/:threadId`, the `abort_turn` operation
 * addressed BY THREAD.
 *
 * Being able to abort from outside is REQUIRED rather than convenient, because
 * `ask` blocks its caller: a caller whose turn overruns its timeout has no other
 * way out, and a CLI caller / external orchestrator / resume-SSE client holds a
 * `threadId` from the start response and nothing else.
 *
 * The behaviour under test is the split of two outcomes that used to be one.
 */
interface Harness {
  app: express.Express;
  chat: ChatService;
  db: Database.Database;
  activeAdapters: Map<string, ActiveAdapter>;
  threadId: string;
}

function makeHarness(): Harness {
  const db = createTestDb();
  const chat = new ChatService(db);
  const threadId = chat.createThread().id;
  const activeAdapters = new Map<string, ActiveAdapter>();
  const deps = {
    chatService: chat,
    activeAdapters,
    pendingInputs: new Map(),
    mode: 'prod',
    cwd: '/tmp',
  } as unknown as AgentTurnDeps;
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter(deps));
  // `chatRouter` deliberately mounts no error handler of its own (an SSE
  // response is already on the wire by the time most of its handlers can fail).
  // Production catches its `next(err)` on the per-project router; this mirrors that.
  app.use(errorHandler);
  return { app, chat, db, activeAdapters, threadId };
}

function activate(h: Harness, opts: { requestId?: string; onAbort?: () => void } = {}): void {
  h.activeAdapters.set(h.threadId, {
    requestId: opts.requestId ?? 'req-1',
    adapter: {
      architecture: 'claude-code',
      execute: () => (async function* () {})(),
      abort: opts.onAbort ?? (() => {}),
      pushMessage: () => false,
    } as unknown as ActiveAdapter['adapter'],
    emitter: new EventEmitter(),
    replay: { turnStart: { type: 'turn_start' }, events: [] },
    emit: () => {},
  });
}

describe('POST /api/chat/abort/:threadId', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.db.close());

  it('[ac:ac-abort-post-api-chat-abort-oraz-abort] aborts a live turn and reports the cleared queue', async () => {
    let aborted = false;
    activate(h, { onAbort: () => (aborted = true) });
    h.chat.enqueueQueued(h.threadId, 'pending');

    const res = await request(h.app).post(`/api/chat/abort/${h.threadId}`).expect(200);
    expect(res.body.data.aborted).toBe(true);
    expect(res.body.clearedTexts).toEqual(['pending']);
    expect(aborted).toBe(true);
  });

  it('is idempotent — a known thread with no live turn is a 2xx no-op, not an error', async () => {
    const first = await request(h.app).post(`/api/chat/abort/${h.threadId}`).expect(200);
    expect(first.body.data.aborted).toBe(false);
    // Twice in a row, because "abort twice" is the case the contract is about.
    const second = await request(h.app).post(`/api/chat/abort/${h.threadId}`).expect(200);
    expect(second.body.data.aborted).toBe(false);
    expect(second.body.clearedTexts).toEqual([]);
  });

  it('aborting an already-aborted thread stays a no-op', async () => {
    activate(h);
    await request(h.app).post(`/api/chat/abort/${h.threadId}`).expect(200);
    h.activeAdapters.delete(h.threadId); // what the turn's `finally` does
    const again = await request(h.app).post(`/api/chat/abort/${h.threadId}`).expect(200);
    expect(again.body.data.aborted).toBe(false);
  });

  it('404s THREAD_NOT_FOUND for a thread that does not exist', async () => {
    // Previously this answered 200 `{ aborted: false }` — identical to the
    // idempotent no-op above — so a typo'd id looked like a completed abort.
    const res = await request(h.app).post('/api/chat/abort/no-such-thread').expect(404);
    expect(res.body.error.code).toBe('THREAD_NOT_FOUND');
  });

  it('still aborts a live turn whose thread row was deleted underneath it', async () => {
    // `DELETE /api/threads/:id` removes the row without touching `activeAdapters`
    // or aborting anything, so the turn keeps running — and keeps writing to the
    // specification. A thread-existence check placed BEFORE the adapter lookup
    // answers 404 here and leaves that turn with no kill switch at all, since a
    // resume-SSE or CLI caller holds only a threadId.
    let aborted = false;
    activate(h, { onAbort: () => (aborted = true) });
    h.chat.deleteThread(h.threadId);
    expect(h.chat.getThreadMeta(h.threadId)).toBeNull();

    const res = await request(h.app).post(`/api/chat/abort/${h.threadId}`).expect(200);
    expect(res.body.data.aborted).toBe(true);
    expect(aborted).toBe(true);
  });

  it('leaves the requestId-addressed variant alone', async () => {
    activate(h, { requestId: 'req-9' });
    const res = await request(h.app).post('/api/chat/abort').send({ requestId: 'req-9' }).expect(200);
    expect(res.body.data.aborted).toBe(true);
    // It searches the live adapter map by a value that only exists WHILE a turn
    // runs, so it has no thread to have found or not found — an unknown
    // requestId stays a 200 no-op rather than becoming a 404.
    const miss = await request(h.app).post('/api/chat/abort').send({ requestId: 'nope' }).expect(200);
    expect(miss.body.data.aborted).toBe(false);
  });
});
