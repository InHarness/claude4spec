import { describe, it, expect } from 'vitest';
import {
  holdEndingKindFor,
  holdEndingLabel,
  nextParked,
  terminalErrorToast,
  turnBusyIndicator,
} from './useChat.js';
import { subagentDisplayStatus } from './SubagentPanel.js';
import { backgroundHoldExpiredMessage } from '../../shared/agent-turn.js';

/**
 * 0.2.107: four ways a turn ends besides a quiet close, and the UI must keep
 * them apart, and everything keys on the SSE `error` code.
 */
describe('turn endings (0.2.107)', () => {
  it('[ac:ac-przekroczenie-capa-oczekiwania-na-zad] maps each terminal code to its own hold ending', () => {
    const kinds = ['ABORTED', 'IDLE_TIMEOUT', 'TIMEOUT', 'BACKGROUND_HOLD_EXPIRED'].map(holdEndingKindFor);
    expect(kinds).toEqual(['user-abort', 'went-silent', 'backstop-expired', 'hold-expired']);
    expect(new Set(kinds.map((kind) => holdEndingLabel({ kind, abandoned: 2 }))).size).toBe(4);
  });

  it('labels the fourth hold state — the turn went silent', () => {
    expect(holdEndingLabel({ kind: 'went-silent', abandoned: 1 })).toMatch(/went idle.*1 background task abandoned/);
  });

  it('[ac:ac-przekroczenie-czasu-odpowiedzi-agenta] reports a backstop TIMEOUT as an idle-clock failure, not a slow agent', () => {
    const t = terminalErrorToast('TIMEOUT', 'Agent took too long to respond');
    expect(t?.level).toBe('error');
    expect(t?.message).toMatch(/idle clock failed/);
  });

  it('keeps a user Stop silent and an idle stop a warning', () => {
    expect(terminalErrorToast('ABORTED', 'Aborted by user')).toBeNull();
    expect(terminalErrorToast('IDLE_TIMEOUT', 'Agent went idle for 60 min with nothing in flight')).toEqual({
      level: 'warning',
      message: 'Agent went idle for 60 min with nothing in flight',
    });
    expect(terminalErrorToast('AGENT_ERROR', 'boom')).toEqual({ level: 'error', message: 'boom' });
  });
});

/**
 * 0.2.109: the turn busy indicator — shown only while the turn is PARKED
 * (after a non-terminal `result`, before `done`).
 */
describe('turn busy indicator (0.2.109)', () => {
  const park = (events: Array<{ type: string; code?: string }>) => events.reduce(nextParked, false);

  it('[ac:ac-przed-pierwszym-result-tury-wskaznik] does not show before the first result of the turn', () => {
    expect(park([{ type: 'turn_start' }, { type: 'text_delta' }, { type: 'subagent_started' }])).toBe(false);
    expect(turnBusyIndicator({ isParked: false, heldBackgroundTaskCount: 2, liveDelegation: true })).toBe('none');
  });

  it('[ac:ac-wskaznik-zajetosci-pokazuje-sie-na-za] shows on a parked turn even when zero background tasks are live', () => {
    expect(park([{ type: 'turn_start' }, { type: 'result' }])).toBe(true);
    expect(turnBusyIndicator({ isParked: true, heldBackgroundTaskCount: 0, liveDelegation: false })).toBe('neutral');
  });

  it('[ac:ac-tura-zaparkowana-wylacznie-na-delegac] a turn parked only on a delegation renders no hold spinner', () => {
    expect(turnBusyIndicator({ isParked: true, heldBackgroundTaskCount: 0, liveDelegation: true })).toBe('none');
  });

  it('N counts background tasks only; both axes can be on screen at once', () => {
    // The spinner is chosen by background tasks alone; the delegation keeps its
    // own `running` header beside it.
    expect(turnBusyIndicator({ isParked: true, heldBackgroundTaskCount: 1, liveDelegation: true })).toBe('background');
  });

  it('the continuation turn_start, done and a terminal error unpark; side-request errors do not', () => {
    expect(park([{ type: 'result' }, { type: 'turn_start' }])).toBe(false);
    expect(park([{ type: 'result' }, { type: 'done' }])).toBe(false);
    expect(park([{ type: 'result' }, { type: 'error', code: 'BACKGROUND_HOLD_EXPIRED' }])).toBe(false);
    expect(park([{ type: 'result' }, { type: 'error', code: 'QUEUE_ERROR' }])).toBe(true);
    expect(park([{ type: 'result' }, { type: 'subagent_completed' }])).toBe(true);
  });

  it('a mid-turn push or the main model speaking again unparks; subagent traffic does not', () => {
    const ev = (e: Record<string, unknown>) => e as { type: string };
    expect(park([{ type: 'result' }, { type: 'user_message' }])).toBe(false);
    expect(park([{ type: 'result' }, ev({ type: 'text_delta', isSubagent: false })])).toBe(false);
    expect(park([{ type: 'result' }, ev({ type: 'text_delta', isSubagent: true })])).toBe(true);
    expect(park([{ type: 'result' }, ev({ type: 'tool_use', isSubagent: false, subagentTaskId: 'sub_1' })])).toBe(true);
  });
});

describe('delegation card status (0.2.109)', () => {
  it('[ac:ac-w-zywej-sesji-karta-delegacji-bez-sub] in a live session a card without subagent_completed stops showing running once the turn closes', () => {
    expect(subagentDisplayStatus('running', true)).toBe('running');
    expect(subagentDisplayStatus('running', false)).toBe('abandoned');
  });

  it('after a reload an abandoned row does not show running', () => {
    expect(subagentDisplayStatus('abandoned', false)).toBe('abandoned');
    expect(subagentDisplayStatus('abandoned', true)).toBe('abandoned');
  });

  it('abandoned is not a failure', () => {
    expect(subagentDisplayStatus('failed', false)).toBe('failed');
    expect(subagentDisplayStatus('aborted', false)).toBe('abandoned');
    expect(subagentDisplayStatus('completed', false)).toBe('completed');
  });
});

describe('hold-expired message (0.2.109)', () => {
  it('names each non-empty registry on its own', () => {
    expect(backgroundHoldExpiredMessage(300_000, 2, 0)).toContain('2 background task(s) still running');
    expect(backgroundHoldExpiredMessage(300_000, 0, 3)).toContain('3 subagent delegation(s) still running');
    expect(backgroundHoldExpiredMessage(300_000, 1, 1)).toContain('1 background task(s) and 1 subagent delegation(s)');
  });

  it('carries no count when both registries are empty', () => {
    expect(backgroundHoldExpiredMessage(300_000, 0, 0)).toBe(
      'background hold expired after 300000ms with no recognized cause',
    );
  });
});
