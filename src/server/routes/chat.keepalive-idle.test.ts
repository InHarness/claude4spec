import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { chatRouter } from './chat.js';
import { IdleWatchdog } from './idle-watchdog.js';
import type { ActiveAdapter, AgentTurnDeps } from './agent-turn.js';

/**
 * 0.2.107: the SSE keepalive must NOT feed the idle watchdog. It ticks every
 * 20 s whether or not the adapter is alive — a watchdog it could re-arm would
 * never fire. Driven through the real resume stream: a joiner sits on a silent
 * turn long enough for many keepalives, and the turn's clock is never kicked.
 */
describe('chat SSE keepalive vs the idle watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[ac:ac-keepalive-sse-nie-zeruje-zegara-idle] keepalive frames never re-arm the turn idle clock', async () => {
    // Only the heartbeat interval is faked; sockets and supertest keep real time.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const emitter = new EventEmitter();
    const idleTimer = new IdleWatchdog(600_000, () => {});
    const kick = vi.spyOn(idleTimer, 'kick');
    const active = {
      requestId: 'req_1',
      adapter: { abort: () => {} },
      emitter,
      replay: { turnStart: { type: 'turn_start' }, events: [], bytes: 0 },
      emit: () => {},
      idleTimer,
    } as unknown as ActiveAdapter;
    const deps = {
      chatService: { listQueued: () => [], clearQueued: () => [], getThreadMeta: () => null },
      activeAdapters: new Map([['t1', active]]),
      pendingInputs: new Map(),
      cwd: process.cwd(),
      roots: [],
    } as unknown as AgentTurnDeps;
    const app = express().use(express.json()).use('/chat', chatRouter(deps));

    // `.then` sends the request (supertest is lazy); polled with a real
    // setTimeout because `vi.waitFor` rides the faked interval.
    const pending = request(app).get('/chat/stream/t1').then((r) => r);
    while (emitter.listenerCount('event') === 0) await new Promise((r) => setTimeout(r, 5));
    // 30 keepalives' worth of silence.
    vi.advanceTimersByTime(30 * 20_000);
    emitter.emit('event', { type: 'done' });
    const res = await pending;

    expect(res.text).toContain(':\n\n');
    expect(kick).not.toHaveBeenCalled();
    idleTimer.stop();
  });
});
