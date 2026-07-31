/**
 * 0.2.4 — the vendored host-kit copies must behave identically to their host
 * originals, and something has to check that.
 *
 * `plugins/c4s-plugin-api-contracts/src/host-kit/` exists because a plugin
 * cannot import from the host's source tree, so the timestamp rule is written
 * twice. Duplication is the accepted cost; SILENT divergence is not. Nothing
 * else in the suite compares them: the two 0.2.4 gates in
 * `single-abstraction.test.ts` grep services for `datetime('now')` and
 * serializers for `createdAt`, and neither looks at these two files. A future
 * edit to the host rule would compile, typecheck and pass the whole suite while
 * `endpoint` and `dto` quietly kept the old one.
 *
 * The gate is BEHAVIOURAL rather than textual. A text diff would fail on a
 * reworded comment and pass on a semantically equivalent refactor — precisely
 * backwards. These assertions pin what the two files have to agree about: the
 * shared list order, the timestamp normalizer, and the stamp-resolution rule.
 */

import { describe, expect, it } from 'vitest';
import * as hostStamp from '../../../src/server/entities/system-stamp.js';
import * as hostFields from '../../../src/server/serialization/system-fields.js';
import * as kit from '../../../plugins/c4s-plugin-api-contracts/src/host-kit/system-stamp.js';

/**
 * The host splits the rule across two modules — `system-fields.ts` owns the
 * clock and the normalizer, `system-stamp.ts` owns the resolution rule — while
 * the vendored kit inlines both into one file, because a plugin gets one import
 * path. Parity is therefore between the kit and the UNION of the two, not
 * between two files.
 */
const host = { ...hostFields, ...hostStamp };

describe('host-kit system-stamp is in parity with the host original', () => {
  it('agrees on the shared list order', () => {
    // Divergence here splits the unified order down the middle: `ac`, `diagram`,
    // `ui-view` and `design-system` would order one way while `endpoint` and
    // `dto` ordered another, and `RawEntityReader.orderClause` would disagree
    // with both — so paging one type through REST and through `list_entities`
    // would return overlapping and missing rows.
    expect(kit.ENTITY_LIST_ORDER).toBe(host.ENTITY_LIST_ORDER);
  });

  it('normalizes every timestamp form identically', () => {
    const inputs = [
      '2026-01-01 12:00:00', // legacy SQLite `datetime('now')`
      '2026-07-31T12:00:00.000Z', // already normalized
      '2026-07-31T12:00:00+02:00', // offset form
      '2026-02-29 00:00:00', // not a leap year — invalid date
      '',
      '   ',
      'not a date',
      null,
      undefined,
      42,
      {},
    ];
    for (const input of inputs) {
      expect(kit.toIsoMs(input), `toIsoMs(${JSON.stringify(input)})`).toBe(host.toIsoMs(input));
    }
  });

  it('resolves a supplied stamp verbatim, identically', () => {
    const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' };
    expect(kit.resolveStamp('dto', { stamp })).toEqual(host.resolveStamp('dto', { stamp }));
    expect(kit.resolveStamp('dto', { stamp })).toEqual(stamp);
  });

  it('preserves an existing created_at on update, identically — including the legacy form', () => {
    for (const existing of [
      { created_at: '2026-01-01T00:00:00.000Z' },
      { created_at: '2026-01-01 00:00:00' },
      { created_at: null },
      {},
    ]) {
      const a = host.resolveStamp('dto', {}, existing);
      const b = kit.resolveStamp('dto', {}, existing);
      // `updatedAt` is `now` on both sides and cannot be compared directly.
      expect(b.createdAt).toBe(a.createdAt);
    }
  });

  it('mints both halves on a create, identically in shape', () => {
    const a = host.resolveStamp('dto', {});
    const b = kit.resolveStamp('dto', {});
    expect(a.createdAt).toBe(a.updatedAt);
    expect(b.createdAt).toBe(b.updatedAt);
    expect(b.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('exports the same public surface', () => {
    // A slot added on one side and not the other is the other way this drifts.
    // The kit is allowed to omit host-only helpers it has no use for
    // (`attachSystemFields` and friends live on the host's serialization
    // chokepoints); what it must never do is EXPORT something the host does not.
    const hostSurface = new Set(Object.keys(host));
    const kitOnly = Object.keys(kit).filter((k) => !hostSurface.has(k));
    expect(kitOnly).toEqual([]);
    // And it must carry the three the plugin services actually call.
    for (const required of ['ENTITY_LIST_ORDER', 'resolveStamp', 'toIsoMs']) {
      expect(Object.keys(kit)).toContain(required);
    }
  });
});
