import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/test-db.js';
import { applyProjection } from '../../db/projection.js';
import { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import { PluginRegistryImpl } from '../../core/plugin-host/registry.js';
import { acBackendModule } from './plugin.js';
import { readActiveAcs } from './read-acs.js';

/**
 * A REAL reader over a REAL generated projection.
 *
 * That is the whole point of this file. `readActiveAcs` originally reached
 * `verifies` through `reader.readCollection`, which is the accessor for a
 * PROJECTED collection — and `ac.verifies` declares no `keyFields`, so it stays
 * embedded JSON on the `ac.verifies` column. `readCollection` queried a
 * non-existent `ac_verifies` table, the reader swallowed the `no such table`
 * error, and every AC came back with `verifies: []`.
 *
 * Silently, and with consequences two layers away: `check_consistency` built its
 * `coveredByVerifies` set from nothing, so it reported every entity in the spec
 * as lacking AC coverage and never reported a broken verify; the LLM audit
 * skipped every AC as having nothing resolvable to compare against.
 *
 * The existing unit test could not catch it — `ac-analysis.test.ts` stubs the
 * reader with `readCollection: () => verifies`, so it asserted the shape the
 * code assumed rather than the one the reader produces. A fake reader can only
 * ever confirm the caller's own belief about the storage layout, which is
 * exactly what was wrong.
 */
function readerOver(db: ReturnType<typeof createTestDb>): RawEntityReader {
  const registry = new PluginRegistryImpl();
  registry.registerEntityModule(acBackendModule);
  const host = registry.consolidate(null);
  applyProjection(db, host.listAvailable());
  return new RawEntityReader(db, host);
}

const insert = (
  db: ReturnType<typeof createTestDb>,
  slug: string,
  text: string,
  status: string,
  verifies: unknown,
) =>
  db
    .prepare('INSERT INTO ac (slug, title, text, kind, status, verifies) VALUES (?, ?, ?, ?, ?, ?)')
    .run(slug, text, text, 'requirement', status, JSON.stringify(verifies));

describe('readActiveAcs', () => {
  it('reads the embedded verifies collection off the row', () => {
    const db = createTestDb();
    try {
      const reader = readerOver(db);
      insert(db, 'ac-1', 'the endpoint answers', 'active', [
        { type: 'endpoint', slug: 'get-users' },
        { type: 'dto', slug: 'user-dto' },
      ]);

      const [ac] = readActiveAcs(reader);
      expect(ac?.verifies).toEqual([
        { type: 'endpoint', slug: 'get-users' },
        { type: 'dto', slug: 'user-dto' },
      ]);
      expect(ac?.text).toBe('the endpoint answers');
      expect(ac?.kind).toBe('requirement');
    } finally {
      db.close();
    }
  });

  it('applies the declared status default, and reports no verifies as empty', () => {
    const db = createTestDb();
    try {
      const reader = readerOver(db);
      insert(db, 'ac-active', 'still true', 'active', []);
      insert(db, 'ac-gone', 'no longer true', 'deprecated', [{ type: 'endpoint', slug: 'x' }]);

      const acs = readActiveAcs(reader);
      // `deprecated` is out — from `ac`'s own `defaultPredicate`, not from a
      // literal restated here.
      expect(acs.map((a) => a.slug)).toEqual(['ac-active']);
      expect(acs[0]?.verifies).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('skips a corrupt entry rather than surfacing a half-formed reference', () => {
    const db = createTestDb();
    try {
      const reader = readerOver(db);
      insert(db, 'ac-1', 'mixed', 'active', [
        { type: 'endpoint', slug: 'get-users' },
        { type: 'endpoint' },
        { slug: 'orphan' },
        'not an object',
      ]);

      // A ref with no slug would be reported as broken by `classifyVerifies`,
      // which is worse than not reporting it: the entity it names is unknowable.
      expect(readActiveAcs(reader)[0]?.verifies).toEqual([{ type: 'endpoint', slug: 'get-users' }]);
    } finally {
      db.close();
    }
  });
});
