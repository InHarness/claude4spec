/**
 * 0.2.4 — the host-global rule that a timestamp is not a substantive change.
 *
 * These are unit tests on the chokepoints rather than integration tests through
 * a type, on purpose: the guarantee is that the rule holds for EVERY type,
 * including plugin-contributed ones whose `diff` slot the host never sees. That
 * is only true if the stripping happens before dispatch, which is what the
 * per-type case below pins.
 */

import { describe, expect, it } from 'vitest';
import { defaultDeepDiff, diffEntity } from './snapshot.js';
import {
  attachSystemFields,
  readSystemFields,
  stripSystemFields,
  toIsoMs,
} from './system-fields.js';
import type { PluginHost } from '../core/plugin-host/types.js';

const STAMP_A = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const STAMP_B = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-31T12:00:00.000Z' };

/** A host whose `diff` slot is a plain deep-equality check — enough to observe what it was handed. */
function hostWithDiffSlot(seen: unknown[]): PluginHost {
  return {
    getEntity: () => ({
      serializer: {
        diff: (a: unknown, b: unknown, slug: string) => {
          seen.push({ a, b });
          return JSON.stringify(a) === JSON.stringify(b)
            ? { type: 'x', slug, op: 'noop' as const }
            : { type: 'x', slug, op: 'modified' as const };
        },
      },
    }),
  } as unknown as PluginHost;
}

describe('system-fields', () => {
  it('normalizes a legacy SQLite timestamp as UTC, not local time', () => {
    // `new Date('2026-01-01 12:00:00')` is LOCAL by spec — the appended `Z` is
    // what stops every pre-0.2.4 value shifting by the host's offset.
    expect(toIsoMs('2026-01-01 12:00:00')).toBe('2026-01-01T12:00:00.000Z');
  });

  it('is idempotent on an already-normalized value', () => {
    expect(toIsoMs('2026-07-31T12:00:00.000Z')).toBe('2026-07-31T12:00:00.000Z');
  });

  it('reads null when either half is missing or unparseable', () => {
    expect(readSystemFields({ createdAt: STAMP_A.createdAt })).toBeNull();
    expect(readSystemFields({ createdAt: 'not a date', updatedAt: STAMP_A.updatedAt })).toBeNull();
    expect(readSystemFields(null)).toBeNull();
  });

  it('attach then strip is the identity', () => {
    const payload = { slug: 'x', name: 'X' };
    expect(stripSystemFields(attachSystemFields(payload, STAMP_A))).toEqual(payload);
  });

  it('leaves a non-object snapshot alone rather than inventing a wrapper', () => {
    // A type whose serializer returns an array has nowhere to put the keys, and
    // wrapping it would silently change that type's on-disk file shape.
    expect(attachSystemFields([1, 2], STAMP_A)).toEqual([1, 2]);
  });
});

describe('a stamp-only delta is noop', () => {
  it('[ac:ac-slot-diff-jest-opcjonalny-typ-bez-dek] through defaultDeepDiff', () => {
    const payload = { slug: 'x', name: 'X' };
    const diff = defaultDeepDiff(
      'x',
      'x',
      attachSystemFields(payload, STAMP_A),
      attachSystemFields(payload, STAMP_B),
    );
    expect(diff.op).toBe('noop');
  });

  it('[ac:ac-slot-diff-jest-opcjonalny-typ-bez-dek] through a per-type diff slot — the envelope never reaches the serializer', () => {
    const seen: unknown[] = [];
    const payload = { slug: 'x', name: 'X' };
    const diff = diffEntity(
      hostWithDiffSlot(seen),
      'x',
      attachSystemFields(payload, STAMP_A),
      attachSystemFields(payload, STAMP_B),
      'x',
    );
    expect(diff.op).toBe('noop');
    // The point of stripping BEFORE dispatch: a plugin's own diff slot cannot be
    // asked to know about a host concern it was written years before.
    expect(seen).toEqual([{ a: payload, b: payload }]);
  });

  it('but a real content change still reads as modified', () => {
    const diff = defaultDeepDiff(
      'x',
      'x',
      attachSystemFields({ slug: 'x', name: 'X' }, STAMP_A),
      attachSystemFields({ slug: 'x', name: 'Y' }, STAMP_B),
    );
    expect(diff.op).toBe('modified');
    // And the envelope is absent from the reported delta, not merely ignored.
    expect(JSON.stringify(diff.raw)).not.toMatch(/createdAt|updatedAt/);
  });
});
