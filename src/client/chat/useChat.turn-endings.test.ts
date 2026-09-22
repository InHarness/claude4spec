import { describe, it, expect } from 'vitest';
import { holdEndingKindFor, holdEndingLabel, terminalErrorToast } from './useChat.js';

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
