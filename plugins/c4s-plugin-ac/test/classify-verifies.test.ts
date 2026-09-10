/**
 * The envelope's classifier, over `ctx.host`.
 *
 * The three-way verdict is the whole point, and it is the reason this goes
 * through the registry view rather than the read core: `describeTypes` throws
 * `INVALID_TYPE` for an unregistered type AND for a deactivated one, so a
 * classifier built on it would collapse `unknown` and `inactive` into a single
 * answer and the detail panel would stop being able to say which. The read core
 * answers about entity shapes and records; whether a type exists at all is the
 * registry's question.
 *
 * The core keeps its own copy for `check_consistency` rules 9-11, tested against
 * a REAL host in `src/server/discovery/ops/ac-rules.test.ts`. This file covers
 * the branch logic; that one covers the host semantics.
 */

import { describe, expect, it } from 'vitest';
import { classifyVerifies } from '../src/entity/ac/backend/classify-verifies.js';
import type { HostRegistryView } from '../src/host-kit/host-types.js';

const hostWith = (over: Partial<HostRegistryView> = {}): HostRegistryView => ({
  getAvailable: () => ({}),
  isActive: () => true,
  entityExists: () => true,
  getEntity: () => ({}),
  ...over,
});

describe('classifyVerifies', () => {
  it('reports nothing when every ref resolves', () => {
    expect(classifyVerifies(hostWith(), [{ type: 'diagram', slug: 'flow' }])).toEqual([]);
  });

  it('distinguishes an unregistered type from a deactivated one', () => {
    const unknown = hostWith({ getAvailable: () => null });
    expect(classifyVerifies(unknown, [{ type: 'nope', slug: 'x' }])).toEqual([
      { type: 'nope', slug: 'x', reason: 'unknown' },
    ]);

    const inactive = hostWith({ isActive: () => false });
    expect(classifyVerifies(inactive, [{ type: 'diagram', slug: 'flow' }])).toEqual([
      { type: 'diagram', slug: 'flow', reason: 'inactive' },
    ]);
  });

  it('reports a missing entity of an active type', () => {
    const host = hostWith({ entityExists: () => false });
    expect(classifyVerifies(host, [{ type: 'diagram', slug: 'gone' }])).toEqual([
      { type: 'diagram', slug: 'gone', reason: 'missing' },
    ]);
  });

  /**
   * No host → NO verdict, rather than "everything is broken".
   *
   * An empty list reads as "nothing is broken", which is the honest answer to a
   * question that was never asked. A full list would paint every AC in the UI
   * red the first time a caller happened to be built without a host.
   */
  it('returns no verdict at all without a host', () => {
    expect(classifyVerifies(undefined, [{ type: 'diagram', slug: 'flow' }])).toEqual([]);
  });

  it('classifies each ref independently', () => {
    const host = hostWith({
      getAvailable: (t) => (t === 'nope' ? null : {}),
      entityExists: (_t, s) => s !== 'gone',
    });
    expect(
      classifyVerifies(host, [
        { type: 'diagram', slug: 'flow' },
        { type: 'nope', slug: 'x' },
        { type: 'diagram', slug: 'gone' },
      ]),
    ).toEqual([
      { type: 'nope', slug: 'x', reason: 'unknown' },
      { type: 'diagram', slug: 'gone', reason: 'missing' },
    ]);
  });
});
