import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { ChatService } from '../../../src/server/services/chat.js';
import { chatRouter } from '../../../src/server/routes/chat.js';
import type { ActiveAdapter, AgentTurnDeps } from '../../../src/server/routes/agent-turn.js';

// --- ChatService queue methods (M05) ---------------------------------------

describe('ChatService queue methods', () => {
  let db: Database.Database;
  let chat: ChatService;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    chat = new ChatService(db);
    threadId = chat.createThread().id;
  });
  afterEach(() => db.close());

  it('enqueues in monotonic position order and lists position ASC', () => {
    chat.enqueueQueued(threadId, 'first');
    chat.enqueueQueued(threadId, 'second', JSON.stringify([{ id: 'a', text: 't', comment: '', page: 'p' }]), 'pages/x.md');
    const queued = chat.listQueued(threadId);
    expect(queued.map((q) => q.text)).toEqual(['first', 'second']);
    // QueuedMessage wire shape: id is stringified row id, createdAt present.
    expect(typeof queued[0]!.id).toBe('string');
    expect(typeof queued[0]!.createdAt).toBe('string');
    expect(chat.countQueued(threadId)).toBe(2);
  });

  it('removeQueued deletes by id and returns false when gone', () => {
    const a = chat.enqueueQueued(threadId, 'a');
    chat.enqueueQueued(threadId, 'b');
    expect(chat.removeQueued(threadId, a.id)).toBe(true);
    expect(chat.listQueued(threadId).map((q) => q.text)).toEqual(['b']);
    expect(chat.removeQueued(threadId, a.id)).toBe(false);
    expect(chat.removeQueued(threadId, 'not-a-number')).toBe(false);
  });

  it('popAllQueued drains FIFO and clearQueued returns texts', () => {
    chat.enqueueQueued(threadId, 'x');
    chat.enqueueQueued(threadId, 'y');
    const popped = chat.popAllQueued(threadId);
    expect(popped.map((r) => r.prompt)).toEqual(['x', 'y']);
    expect(chat.countQueued(threadId)).toBe(0);
    // already drained
    expect(chat.clearQueued(threadId)).toEqual([]);
  });

  it('cascades on thread delete', () => {
    chat.enqueueQueued(threadId, 'a');
    chat.deleteThread(threadId);
    expect(chat.countQueued(threadId)).toBe(0);
  });
});

// --- initialArchitectureConfig projection (M05 0.1.61) ---------------------

describe('ChatService initialArchitectureConfig projection', () => {
  let db: Database.Database;
  let chat: ChatService;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    chat = new ChatService(db);
    threadId = chat.createThread().id;
  });
  afterEach(() => db.close());

  it('is null for a fresh thread (no turn-1 snapshot)', () => {
    expect(chat.getThread(threadId)!.thread.initialArchitectureConfig).toBeNull();
  });

  it('round-trips the turn-1 snapshot', () => {
    chat.setInitialArchitectureConfig(threadId, {
      model: 'opus-4.8',
      architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' },
    });
    expect(chat.getThread(threadId)!.thread.initialArchitectureConfig).toEqual({
      model: 'opus-4.8',
      architectureConfig: { claude_thinking: 'adaptive', claude_effort: 'high' },
    });
  });

  it('defensively yields null when the stored JSON is corrupt', () => {
    db.prepare(`UPDATE chat_thread SET initial_architecture_config_json = ? WHERE id = ?`).run(
      '{not json',
      threadId,
    );
    expect(chat.getThread(threadId)!.thread.initialArchitectureConfig).toBeNull();
  });
});

// --- Queue HTTP endpoints + abort (M05) ------------------------------------

interface Harness {
  app: express.Express;
  chat: ChatService;
  activeAdapters: Map<string, ActiveAdapter>;
  threadId: string;
}

function makeHarness(): Harness {
  const db = createTestDb();
  const chat = new ChatService(db);
  const threadId = chat.createThread().id;
  const activeAdapters = new Map<string, ActiveAdapter>();
  const pendingInputs = new Map();
  const deps = {
    chatService: chat,
    activeAdapters,
    pendingInputs,
    mode: 'prod',
    cwd: '/tmp',
  } as unknown as AgentTurnDeps;
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter(deps));
  return { app, chat, activeAdapters, threadId };
}

/** Register a fake live turn so the queue endpoints see an active stream. */
function activate(
  h: Harness,
  opts: { requestId?: string; push?: (text: string) => boolean } = {},
): { emitted: Array<{ type: string } & Record<string, unknown>> } {
  const emitted: Array<{ type: string } & Record<string, unknown>> = [];
  const entry: ActiveAdapter = {
    requestId: opts.requestId ?? 'req-1',
    adapter: {
      architecture: 'claude-code',
      execute: () => (async function* () {})(),
      abort: () => {},
      pushMessage: opts.push ?? (() => false),
    } as unknown as ActiveAdapter['adapter'],
    emitter: new EventEmitter(),
    replay: { turnStart: { type: 'turn_start' }, events: [] },
    emit: (e) => emitted.push(e),
  };
  h.activeAdapters.set(h.threadId, entry);
  return { emitted };
}

describe('queue HTTP endpoints', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('409 NO_ACTIVE_STREAM when no turn is live', async () => {
    const res = await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'hi' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ACTIVE_STREAM');
  });

  it('202 + snapshot when push declines (row waits for after-turn dispatch)', async () => {
    const { emitted } = activate(h, { push: () => false });
    const res = await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'later' });
    expect(res.status).toBe(202);
    expect(res.body.queued.map((q: { text: string }) => q.text)).toEqual(['later']);
    expect(h.chat.countQueued(h.threadId)).toBe(1);
    expect(emitted.at(-1)?.type).toBe('queue_updated');
  });

  it('mid-turn push success drops the row', async () => {
    activate(h, { push: () => true });
    const res = await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'now' });
    expect(res.status).toBe(202);
    expect(res.body.queued).toEqual([]);
    expect(h.chat.countQueued(h.threadId)).toBe(0);
  });

  it('400 QUEUE_FULL past the 20-row limit', async () => {
    activate(h, { push: () => false });
    for (let i = 0; i < 20; i++) {
      const r = await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: `m${i}` });
      expect(r.status).toBe(202);
    }
    const over = await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'overflow' });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('QUEUE_FULL');
  });

  it('cancel: 200 snapshot, then 404 when already gone', async () => {
    activate(h, { push: () => false });
    await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'a' });
    const row = h.chat.listQueued(h.threadId)[0]!;
    const del = await request(h.app).delete(`/api/chat/queue/${h.threadId}/${row.id}`);
    expect(del.status).toBe(200);
    expect(del.body.queued).toEqual([]);
    const again = await request(h.app).delete(`/api/chat/queue/${h.threadId}/${row.id}`);
    expect(again.status).toBe(404);
  });

  it('clear: 200 clearedTexts + queue_cleared broadcast', async () => {
    const { emitted } = activate(h, { push: () => false });
    await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'one' });
    await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'two' });
    const res = await request(h.app).delete(`/api/chat/queue/${h.threadId}`);
    expect(res.status).toBe(200);
    expect(res.body.clearedTexts).toEqual(['one', 'two']);
    expect(emitted.some((e) => e.type === 'queue_cleared')).toBe(true);
    expect(h.chat.countQueued(h.threadId)).toBe(0);
  });

  it('abort clears the queue and returns top-level clearedTexts', async () => {
    activate(h, { requestId: 'req-9', push: () => false });
    await request(h.app).post(`/api/chat/queue/${h.threadId}`).send({ prompt: 'pending' });
    const res = await request(h.app).post('/api/chat/abort').send({ requestId: 'req-9' });
    expect(res.status).toBe(200);
    expect(res.body.data.aborted).toBe(true);
    // Deviation #1: clearedTexts is TOP-LEVEL (the agent-chat hook reads body.clearedTexts).
    expect(res.body.clearedTexts).toEqual(['pending']);
    expect(h.chat.countQueued(h.threadId)).toBe(0);
  });
});
