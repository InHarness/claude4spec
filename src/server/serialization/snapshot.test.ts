/**
 * 0.2.4 — the host-global rule that a timestamp is not a substantive change.
 *
 * These are unit tests on the chokepoints rather than integration tests through
 * a type, on purpose: the guarantee is that the rule holds for EVERY type at
 * once. 0.2.31 gave it a second, independent enforcement — the delta engine
 * skips `systemManaged` fields by declaration — so the cases below pin BOTH:
 * the envelope is stripped before the walk, and the walk would ignore it anyway.
 */

import { describe, expect, it } from 'vitest';
import { diffEntity } from './snapshot.js';
import {
  attachSystemFields,
  readSystemFields,
  stripSystemFields,
  toIsoMs,
} from './system-fields.js';
import type { PluginHost } from '../core/plugin-host/types.js';

const STAMP_A = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const STAMP_B = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-31T12:00:00.000Z' };

/** A host whose one type declares two ordinary fields — enough to walk. */
function hostWithSchema(): PluginHost {
  return {
    getEntity: () => ({
      data: {
        schema: {
          slug: { type: 'string' },
          name: { type: 'string' },
          createdAt: { type: 'string', systemManaged: true },
          updatedAt: { type: 'string', systemManaged: true },
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
  it('[ac:ac-slot-diff-jest-opcjonalny-typ-bez-dek] the envelope never reaches the walk', () => {
    const payload = { slug: 'x', name: 'X' };
    const diff = diffEntity(
      hostWithSchema(),
      'x',
      attachSystemFields(payload, STAMP_A),
      attachSystemFields(payload, STAMP_B),
    );
    expect(diff).toEqual({ op: 'noop', changes: [] });
  });

  it('but a real content change still reads as updated', () => {
    const diff = diffEntity(
      hostWithSchema(),
      'x',
      attachSystemFields({ slug: 'x', name: 'X' }, STAMP_A),
      attachSystemFields({ slug: 'x', name: 'Y' }, STAMP_B),
    );
    expect(diff.op).toBe('updated');
    expect(diff.changes).toEqual([{ op: 'field_changed', path: 'name', from: 'X', to: 'Y' }]);
    // And the envelope is absent from the reported delta, not merely ignored.
    expect(JSON.stringify(diff.changes)).not.toMatch(/createdAt|updatedAt/);
  });

  it('an unknown type yields noop rather than a shapeless guess', () => {
    const host = { getEntity: () => null } as unknown as PluginHost;
    expect(diffEntity(host, 'nope', { a: 1 }, { a: 2 })).toEqual({ op: 'noop', changes: [] });
  });

  it('created and deleted carry no operations — the full state comes from the snapshot', () => {
    const host = hostWithSchema();
    expect(diffEntity(host, 'x', null, { slug: 'x', name: 'X' })).toEqual({
      op: 'created',
      changes: [],
    });
    expect(diffEntity(host, 'x', { slug: 'x', name: 'X' }, null)).toEqual({
      op: 'deleted',
      changes: [],
    });
  });
});
