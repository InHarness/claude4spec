import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { chatRouter } from './chat.js';
import type { ActiveAdapter, AgentTurnDeps, PendingInput } from './agent-turn.js';

/**
 * M05 0.2.47 — the live-join contract of `GET /api/chat/stream/:threadId`.
 *
 * Auto-resume stopped being a guess about `chat_message.status` and became a
 * two-sided structural contract: the server keeps the CURRENT ITERATION of the
 * turn in an in-RAM buffer and replays it 1:1 on join (or 404s when the turn is
 * dead), while the client cuts RESTORE above the running turn and lets the
 * replay redraw it. Neither half is type-checkable, and a regression on either
 * side is silent — hence these tests.
 */

const THREAD_ID = 't-join';
const TURN_REQUEST_ID = 'turn-req-1';

type Frame = { event: string; data: Record<string, unknown> };

function makeActive(
  events: Array<Record<string, unknown>>,
  turnStart: Record<string, unknown> = { type: 'turn_start', prompt: 'hi' },
  replayExtras: Partial<ActiveAdapter['replay']> = {},
): ActiveAdapter {
  return {
    requestId: TURN_REQUEST_ID,
    adapter: { abort: () => {} } as unknown as ActiveAdapter['adapter'],
    emitter: new EventEmitter(),
    replay: {
      turnStart: turnStart as unknown as ActiveAdapter['replay']['turnStart'],
      events: events as unknown as ActiveAdapter['replay']['events'],
      bytes: 0,
      ...replayExtras,
    },
    emit: () => {},
  };
}

describe('GET /api/chat/stream/:threadId — live-join replay', () => {
  let activeAdapters: Map<string, ActiveAdapter>;
  let pendingInputs: Map<string, PendingInput>;
  let queued: Array<{ id: string; prompt: string }>;

  beforeEach(() => {
    activeAdapters = new Map();
    pendingInputs = new Map();
    queued = [];
  });

  const app = () => {
    const deps = {
      chatService: {
        addMessage: () => {},
        listQueued: () => queued,
        clearQueued: () => [],
        getThreadMeta: () => null,
      },
      activeAdapters,
      pendingInputs,
      cwd: process.cwd(),
      roots: [],
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/chat', chatRouter(deps));
  };

  /** Parse the SSE body into ordered (event name, payload) frames. */
  const parseFrames = (body: string): Frame[] => {
    const frames: Frame[] = [];
    let name: string | null = null;
    for (const line of body.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice('event: '.length).trim();
      else if (line.startsWith('data: ') && name) {
        frames.push({ event: name, data: JSON.parse(line.slice('data: '.length)) });
        name = null;
      }
    }
    return frames;
  };

  /**
   * Join, then (optionally) push events onto the emitter as "live" traffic, then
   * end the turn so the response body settles. `afterJoin` runs on a timer, i.e.
   * strictly after the synchronous replay block has finished.
   */
  const join = async (afterJoin?: (active: ActiveAdapter) => void): Promise<Frame[]> => {
    const active = activeAdapters.get(THREAD_ID)!;
    const pending = request(app()).get(`/chat/stream/${THREAD_ID}`);
    const timer = setTimeout(() => {
      afterJoin?.(active);
      active.emitter.emit('event', { type: 'done' });
    }, 25);
    const res = await pending;
    clearTimeout(timer);
    return parseFrames(res.text);
  };

  it('[ac:ac-live-join-replay-bufora-iteracji-popr] replays connected → turn_start → buffer → queue_updated before the first live event', async () => {
    queued = [{ id: 'q-1', prompt: 'later' }];
    activeAdapters.set(
      THREAD_ID,
      makeActive([
        { type: 'text_delta', text: 'hello ' },
        { type: 'tool_use', toolUseId: 'tu-1', toolName: 'Read', input: {} },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' },
      ]),
    );

    const frames = await join((active) => {
      active.emitter.emit('event', { type: 'text_delta', text: 'live!' });
    });

    const names = frames.map((f) => f.event);
    // The whole replay is one synchronous block, so its order is exact.
    expect(names.slice(0, 6)).toEqual([
      'connected',
      'turn_start',
      'text_delta',
      'tool_use',
      'tool_result',
      'queue_updated',
    ]);
    // …and the live-forwarded delta can only land after it.
    const liveIdx = frames.findIndex((f) => f.data.text === 'live!');
    expect(liveIdx).toBeGreaterThan(names.indexOf('queue_updated'));
  });

  it('the connected frame carries exactly { requestId, threadId } — no `live` flag', async () => {
    activeAdapters.set(THREAD_ID, makeActive([]));

    const frames = await join();

    const connected = frames.find((f) => f.event === 'connected')!;
    // `live` was a relic from before the 404 guard: always true, so it carried no
    // information. 404 is the only "no turn" signal now, and this frame's shape is
    // identical to `connected` from POST /api/chat.
    expect(connected.data).toEqual({ requestId: TURN_REQUEST_ID, threadId: THREAD_ID });
    expect(connected.data).not.toHaveProperty('live');
    // 0.2.50: `replayTruncated` is present ONLY when true, so an untruncated
    // join must not carry the key at all — its presence is the whole signal.
    expect(connected.data).not.toHaveProperty('replayTruncated');
  });

  /**
   * 0.2.50 — the replay buffer got a 4 MB per-iteration budget. When degrading
   * the oldest `tool_result` entries is not enough to get back under it, the
   * joiner is TOLD its replay is incomplete rather than silently handed a
   * partial transcript that looks whole.
   */
  it('[ac:ac-bufor-replay-przekraczajacy-budzet-ba] surfaces replayTruncated on connected when the buffer blew its budget', async () => {
    activeAdapters.set(
      THREAD_ID,
      makeActive([{ type: 'text_delta', text: 'partial' }], undefined, { truncated: true }),
    );

    const frames = await join();

    const connected = frames.find((f) => f.event === 'connected')!;
    expect(connected.data).toEqual({
      requestId: TURN_REQUEST_ID,
      threadId: THREAD_ID,
      replayTruncated: true,
    });
  });

  it('[ac:ac-dolaczenie-do-martwej-tury-404-bez-ot] joining a dead turn 404s without opening an SSE stream', async () => {
    // Empty registry covers all three cases at once: turn finished, thread that
    // never streamed, and every thread after a server restart.
    const res = await request(app()).get(`/chat/stream/${THREAD_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['content-type']).not.toContain('text/event-stream');
    // The pre-404 endpoint opened the stream anyway and emitted `done`; it must not.
    expect(res.text).not.toContain('event: done');
  });

  it('[ac:ac-joiner-widzi-snapshot-kolejki-natychm] a message queued before the join shows up in the replay, not on the next mutation', async () => {
    queued = [{ id: 'q-1', prompt: 'queued before I joined' }];
    activeAdapters.set(THREAD_ID, makeActive([{ type: 'text_delta', text: 'hi' }]));

    const frames = await join();

    const snapshot = frames.filter((f) => f.event === 'queue_updated');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.data).toMatchObject({ queued });
  });

  it('[ac:ac-replay-po-merged-dispatch-obejmuje-ty] a joiner after a merged dispatch sees only the current iteration', async () => {
    const active = makeActive(
      [{ type: 'text_delta', text: 'iteration one' }],
      { type: 'turn_start', prompt: 'first prompt' },
    );
    activeAdapters.set(THREAD_ID, active);

    // After-turn merged dispatch: buffer zeroed, new turn_start seeded. Whoever
    // joins now must get the new iteration only — the earlier one comes from the
    // thread's persisted history, so replaying it too would duplicate it.
    active.replay.events.length = 0;
    active.replay.turnStart = {
      type: 'turn_start',
      prompt: 'merged prompt',
    } as unknown as ActiveAdapter['replay']['turnStart'];
    (active.replay.events as unknown as Array<Record<string, unknown>>).push({
      type: 'text_delta',
      text: 'iteration two',
    });

    const frames = await join();

    expect(frames.find((f) => f.event === 'turn_start')!.data).toMatchObject({
      prompt: 'merged prompt',
    });
    const deltas = frames.filter((f) => f.event === 'text_delta').map((f) => f.data.text);
    expect(deltas).toEqual(['iteration two']);
  });

  it('[ac:ac-tura-czysto-tekstowa-wznawia-sie-po-f] a pure-text turn replays in full, with no tool event anywhere', async () => {
    // The root cause of the whole release: `status='streaming'` is only ever set on
    // `tool_use` rows, so the old heuristic silently lost this entire class of turn.
    // Resuming must depend on the buffer, never on such a row existing.
    activeAdapters.set(
      THREAD_ID,
      makeActive([
        { type: 'text_delta', text: 'a pure ' },
        { type: 'text_delta', text: 'text turn' },
      ]),
    );

    const frames = await join();

    expect(frames.map((f) => f.event)).not.toContain('tool_use');
    const text = frames
      .filter((f) => f.event === 'text_delta')
      .map((f) => f.data.text)
      .join('');
    expect(text).toBe('a pure text turn');
  });

  it('two concurrent joiners each get their own full replay', async () => {
    // The buffer is READ on join, never consumed — N tabs can hang off one turn.
    activeAdapters.set(
      THREAD_ID,
      makeActive([
        { type: 'text_delta', text: 'shared ' },
        { type: 'text_delta', text: 'content' },
      ]),
    );
    const active = activeAdapters.get(THREAD_ID)!;
    const server = app();

    const first = request(server).get(`/chat/stream/${THREAD_ID}`);
    const second = request(server).get(`/chat/stream/${THREAD_ID}`);
    const timer = setTimeout(() => active.emitter.emit('event', { type: 'done' }), 25);
    const [resA, resB] = await Promise.all([first, second]);
    clearTimeout(timer);

    for (const res of [resA, resB]) {
      const frames = parseFrames(res.text);
      expect(frames.map((f) => f.event).slice(0, 4)).toEqual([
        'connected',
        'turn_start',
        'text_delta',
        'text_delta',
      ]);
      const text = frames
        .filter((f) => f.event === 'text_delta')
        .map((f) => f.data.text)
        .join('');
      expect(text).toBe('shared content');
    }
    // Nothing was drained by the first joiner.
    expect(active.replay.events).toHaveLength(2);
  });
});
