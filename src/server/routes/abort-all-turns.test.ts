import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { abortAllTurns, type ActiveAdapter, type PendingInput } from './agent-turn.js';

/**
 * The sweep a ProjectContext runs on dispose.
 *
 * The registries are context-lifetime state keyed by `threadId`, and until this
 * existed nothing released them: dispose closed the database and left every
 * entry in place. That was safe only by accident — `ProjectContextCache`
 * refuses to EVICT a context with an in-flight turn, so the leak was covered by
 * someone else's guard. The two paths that ignore that guard, project purge and
 * process shutdown, disposed underneath a running turn whose `finally` then
 * mutated a disposed context and wrote through a closed handle.
 */
describe('abortAllTurns', () => {
  const adapterEntry = (requestId: string, abort = vi.fn()): ActiveAdapter =>
    ({
      requestId,
      adapter: { abort } as unknown as ActiveAdapter['adapter'],
      emitter: new EventEmitter(),
      replay: { turnStart: {} as never, events: [], bytes: 0 },
      emit: () => {},
    }) as ActiveAdapter;

  it('aborts every live turn and empties both registries', () => {
    const abortA = vi.fn();
    const abortB = vi.fn();
    const activeAdapters = new Map<string, ActiveAdapter>([
      ['thread-a', adapterEntry('req-a', abortA)],
      ['thread-b', adapterEntry('req-b', abortB)],
    ]);
    const pendingInputs = new Map<string, PendingInput>();

    abortAllTurns(activeAdapters, pendingInputs);

    expect(abortA).toHaveBeenCalledOnce();
    expect(abortB).toHaveBeenCalledOnce();
    expect(activeAdapters.size).toBe(0);
    expect(pendingInputs.size).toBe(0);
  });

  it('rejects a turn parked on a user question instead of leaving it hanging', async () => {
    const activeAdapters = new Map<string, ActiveAdapter>([['thread-a', adapterEntry('req-a')]]);
    const pendingInputs = new Map<string, PendingInput>();
    const parked = new Promise<unknown>((resolve, reject) => {
      pendingInputs.set('input-1', {
        resolve: resolve as PendingInput['resolve'],
        reject,
        requestIdsForRequest: 'req-a',
      });
    });

    abortAllTurns(activeAdapters, pendingInputs);

    // Without this the promise never settles, and the turn waits forever on a
    // project that has already been torn down.
    await expect(parked).rejects.toThrow();
  });

  it('keeps going when an adapter is already finished — the normal case at shutdown', () => {
    const healthy = vi.fn();
    const activeAdapters = new Map<string, ActiveAdapter>([
      ['thread-dead', adapterEntry('req-dead', vi.fn(() => {
        throw new Error('adapter already closed');
      }))],
      ['thread-live', adapterEntry('req-live', healthy)],
    ]);

    // A dispose that threw partway would skip everything after it, including
    // closing the database.
    expect(() => abortAllTurns(activeAdapters, new Map())).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(activeAdapters.size).toBe(0);
  });

  it('is idempotent — a context disposed twice is not an error', () => {
    const activeAdapters = new Map<string, ActiveAdapter>();
    const pendingInputs = new Map<string, PendingInput>();
    abortAllTurns(activeAdapters, pendingInputs);
    expect(() => abortAllTurns(activeAdapters, pendingInputs)).not.toThrow();
  });
});
