import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  ABORT_DRAIN_TIMEOUT_MS,
  abortAllTurns,
  type ActiveAdapter,
  type PendingInput,
} from './agent-turn.js';

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

  it('aborts every live turn and empties both registries', async () => {
    const abortA = vi.fn();
    const abortB = vi.fn();
    const activeAdapters = new Map<string, ActiveAdapter>([
      ['thread-a', adapterEntry('req-a', abortA)],
      ['thread-b', adapterEntry('req-b', abortB)],
    ]);
    const pendingInputs = new Map<string, PendingInput>();

    await abortAllTurns(activeAdapters, pendingInputs);

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

    await abortAllTurns(activeAdapters, pendingInputs);

    // Without this the promise never settles, and the turn waits forever on a
    // project that has already been torn down.
    await expect(parked).rejects.toThrow();
  });

  it('keeps going when an adapter is already finished — the normal case at shutdown', async () => {
    const healthy = vi.fn();
    const activeAdapters = new Map<string, ActiveAdapter>([
      ['thread-dead', adapterEntry('req-dead', vi.fn(() => {
        throw new Error('adapter already closed');
      }))],
      ['thread-live', adapterEntry('req-live', healthy)],
    ]);

    // A dispose that threw partway would skip everything after it, including
    // closing the database.
    await expect(abortAllTurns(activeAdapters, new Map())).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledOnce();
    expect(activeAdapters.size).toBe(0);
  });

  it('is idempotent — a context disposed twice is not an error', async () => {
    const activeAdapters = new Map<string, ActiveAdapter>();
    const pendingInputs = new Map<string, PendingInput>();
    await abortAllTurns(activeAdapters, pendingInputs);
    await expect(abortAllTurns(activeAdapters, pendingInputs)).resolves.toBeUndefined();
  });

  /**
   * `adapter.abort()` only STARTS the unwinding; the turn's own `finally` —
   * where `finalizeStreamingRows` writes — runs later. A sweep that returned
   * immediately would let `dispose()` close the database underneath those
   * writes, which is the defect the sweep exists to close, not a narrower
   * version of it.
   */
  it('waits for an aborted turn to finish before returning', async () => {
    let finishTurn: () => void = () => {};
    const entry = adapterEntry('req-a');
    const finished = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });
    const activeAdapters = new Map<string, ActiveAdapter>([
      ['thread-a', { ...entry, finished }],
    ]);

    let swept = false;
    const sweep = abortAllTurns(activeAdapters, new Map()).then(() => {
      swept = true;
    });

    await Promise.resolve();
    expect(swept).toBe(false);

    finishTurn();
    await sweep;
    expect(swept).toBe(true);
  });

  it('gives up on a turn that never settles rather than hanging shutdown', async () => {
    vi.useFakeTimers();
    try {
      const entry = adapterEntry('req-stuck');
      const activeAdapters = new Map<string, ActiveAdapter>([
        // A turn whose `finally` never runs — the promise is never resolved.
        ['thread-stuck', { ...entry, finished: new Promise<void>(() => {}) }],
      ]);

      const sweep = abortAllTurns(activeAdapters, new Map());
      await vi.advanceTimersByTimeAsync(ABORT_DRAIN_TIMEOUT_MS);

      // Unbounded, this would never resolve and the process would never exit.
      await expect(sweep).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
