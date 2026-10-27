import { describe, it, expect } from 'vitest';
import { KeyedQueue } from './keyed-queue.js';

/** A promise the test resolves by hand, to hold a queue slot open. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('KeyedQueue — per-key critical section (M36 m36l4fam)', () => {
  it('runs work on one key strictly in order, each after the previous settled', async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    const g = gate();
    const first = q.run('a', async () => {
      log.push('first:start');
      await g.promise;
      log.push('first:end');
      return 1;
    });
    const second = q.run('a', async () => {
      log.push('second');
      return 2;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['first:start']);
    g.open();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(log).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not serialize different keys against each other', async () => {
    const q = new KeyedQueue();
    const g = gate();
    const blocked = q.run('a', () => g.promise);
    const other = await q.run('b', async () => 'b-done');
    expect(other).toBe('b-done');
    g.open();
    await blocked;
  });

  it('a predecessor that threw still releases the key; its caller gets the error', async () => {
    const q = new KeyedQueue();
    const failing = q.run('a', async () => {
      throw new Error('refused');
    });
    const next = q.run('a', async () => 'ran');
    await expect(failing).rejects.toThrow('refused');
    expect(await next).toBe('ran');
  });

  it('drops a key once its queue drains, so the map does not grow per path written', async () => {
    const q = new KeyedQueue();
    for (let i = 0; i < 50; i++) {
      await q.run(`path-${i}`, async () => i);
    }
    await q.run('err', async () => {
      throw new Error('x');
    }).catch(() => undefined);
    expect(q.size).toBe(0);
  });

  it('keeps the key while a later caller is queued, and drops it after the tail', async () => {
    const q = new KeyedQueue();
    const g = gate();
    const g2 = gate();
    const first = q.run('a', () => g.promise);
    const second = q.run('a', async () => {
      await g2.promise;
      return 'tail';
    });
    expect(q.size).toBe(1);
    g.open();
    await first;
    // The head settled but the tail is still running: the entry must survive.
    expect(q.size).toBe(1);
    g2.open();
    expect(await second).toBe('tail');
    expect(q.size).toBe(0);
  });
});
