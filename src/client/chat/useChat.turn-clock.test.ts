import { describe, it, expect } from 'vitest';
import { createInitialState, messageReducer } from '@inharness-ai/agent-chat';
import type { WireEvent } from '@inharness-ai/agent-chat';
import { formatElapsed, parseServerTime } from './elapsed.js';
import { nextParked, nextTurnStartedAt, startMapFromRows } from './useChat.js';
import { streamingBubbleVisible } from './StreamingBubble.js';

/**
 * 0.2.114: the work clock. `turn_start.turnStartedAt` is the one marker for
 * both the replay buffer's scope and the turn clock — a merged dispatch resets
 * it, a continuation and a mid-turn push do not.
 */

const T0 = '2026-09-25T10:12:03.000Z';
const T1 = '2026-09-25T10:14:52.000Z';
const turnStart = (over: Record<string, unknown> = {}) => ({
  type: 'turn_start',
  userMessageId: 'u1',
  assistantMessageId: 'a1',
  prompt: 'Run the build and report',
  timestamp: T0,
  turnStartedAt: T0,
  ...over,
});

describe('formatElapsed / parseServerTime', () => {
  it('formats m:ss, and h:mm:ss from an hour on', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(5_400)).toBe('0:05');
    expect(formatElapsed(83_000)).toBe('1:23');
    expect(formatElapsed(3_599_999)).toBe('59:59');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-2_000)).toBe('0:00');
  });

  it('reads a raw SQLite datetime as UTC, and passes ISO through', () => {
    expect(parseServerTime('2026-09-25 10:12:03')).toBe(Date.parse(T0));
    expect(parseServerTime(T0)).toBe(Date.parse(T0));
    expect(parseServerTime('')).toBeNull();
    expect(parseServerTime('nonsense')).toBeNull();
  });
});

describe('turn clock rules (nextTurnStartedAt)', () => {
  it('[ac:ac-merged-dispatch-zeruje-zegar-tury] a merged-dispatch turn_start restarts the clock', () => {
    const start = nextTurnStartedAt(null, turnStart());
    const merged = nextTurnStartedAt(start, turnStart({ userMessageId: 'u2', assistantMessageId: 'a2', timestamp: T1, turnStartedAt: T1 }));
    expect(start).toBe(Date.parse(T0));
    expect(merged).toBe(Date.parse(T1));
  });

  it('[ac:ac-kontynuacja-po-zadaniu-w-tle-lub-dele] a continuation turn_start (inherited turnStartedAt) keeps the clock', () => {
    const start = nextTurnStartedAt(null, turnStart());
    expect(nextTurnStartedAt(start, turnStart({ timestamp: T1 }))).toBe(Date.parse(T0));
  });

  it('[ac:ac-wiadomosc-wepchnieta-w-trakcie-pracy] a mid-turn user_message leaves the clock alone', () => {
    const start = Date.parse(T0);
    expect(nextTurnStartedAt(start, { type: 'user_message' })).toBe(start);
    expect(nextTurnStartedAt(start, { type: 'text_delta' })).toBe(start);
  });

  it('[ac:ac-po-f5-nad-zywa-tura-zegar-pokazuje-cz] a joiner takes the start from the replayed turn_start, not from the reload', () => {
    // A joiner starts with no clock; the replayed turn_start carries the
    // server's turn start, minutes before the reload.
    expect(nextTurnStartedAt(null, { type: 'connected' })).toBeNull();
    expect(nextTurnStartedAt(null, turnStart())).toBe(Date.parse(T0));
  });

  it('done and a terminal error clear it; a queue error does not', () => {
    const start = Date.parse(T0);
    expect(nextTurnStartedAt(start, { type: 'done' })).toBeNull();
    expect(nextTurnStartedAt(start, { type: 'error', code: 'ABORTED' })).toBeNull();
    expect(nextTurnStartedAt(start, { type: 'error', code: 'QUEUE_ERROR' })).toBe(start);
  });
});

describe('streaming bubble visibility', () => {
  it('[ac:ac-na-turze-zaparkowanej-banki-streaming] a parked turn hides the bubble (and with it the clock)', () => {
    let parked = false;
    for (const e of [{ type: 'text_delta' }, { type: 'result' }]) parked = nextParked(parked, e);
    expect(parked).toBe(true);
    expect(streamingBubbleVisible({ isStreaming: true, isResuming: false, isParked: parked })).toBe(false);
    expect(streamingBubbleVisible({ isStreaming: false, isResuming: true, isParked: false })).toBe(true);
    expect(streamingBubbleVisible({ isStreaming: true, isResuming: false, isParked: false })).toBe(true);
    expect(streamingBubbleVisible({ isStreaming: false, isResuming: false, isParked: false })).toBe(false);
  });
});

describe('subagent clock fallback (startMapFromRows)', () => {
  it('parses created_at as UTC and keeps the first row per taskId', () => {
    const map = startMapFromRows([
      { taskId: 's1', createdAt: '2026-09-25 10:12:03' },
      { taskId: 's1', createdAt: '2026-09-25 11:00:00' },
      { taskId: 's2', createdAt: 'garbage' },
    ]);
    expect(map.get('s1')).toBe(Date.parse(T0));
    expect(map.has('s2')).toBe(false);
  });
});

/**
 * Section 3 of the brief: a continuation's turn_start carries the ids of the
 * turn start, and the reducer opens no new user/assistant pair for it — the
 * continuation's blocks land in the SAME assistant message.
 */
describe('continuation turn_start — same message (agent-chat reducer)', () => {
  const ev = (e: Record<string, unknown>) => ({ type: 'EVENT', event: e as unknown as WireEvent }) as const;
  const run = (state: ReturnType<typeof createInitialState>, events: Array<Record<string, unknown>>) =>
    events.reduce((s, e) => messageReducer(s, ev(e)), state);

  const tail = [
    { type: 'text_delta', text: 'iteration one' },
    { type: 'result', sessionId: 's-held' },
    turnStart({ timestamp: T1 }),
    { type: 'text_delta', text: 'iteration two' },
  ];

  it('[ac:ac-joiner-dolaczajacy-w-drugiej-iteracji] a joiner replaying both iterations gets one pair with both', () => {
    const s = run(createInitialState('claude-code', 'opus'), [turnStart(), ...tail]);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const text = JSON.stringify(s.messages[1]!.blocks);
    expect(text).toContain('iteration one');
    expect(text).toContain('iteration two');
  });

  it('the sending tab (optimistic pair, no first turn_start) adopts the ids and stays on one pair', () => {
    const sent = messageReducer(createInitialState('claude-code', 'opus'), { type: 'USER_MESSAGE', text: 'Run the build and report' });
    const s = run(sent, tail);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(s.messages[1]!.id).toBe('a1');
    expect(JSON.stringify(s.messages[1]!.blocks)).toContain('iteration two');
  });

  it('a merged dispatch (new ids) opens a new pair', () => {
    const s = run(createInitialState('claude-code', 'opus'), [
      turnStart(),
      { type: 'text_delta', text: 'first' },
      { type: 'result', sessionId: 's1' },
      turnStart({ userMessageId: 'u2', assistantMessageId: 'a2', prompt: 'merged', timestamp: T1, turnStartedAt: T1 }),
    ]);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });
});
