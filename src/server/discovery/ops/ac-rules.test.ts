/**
 * The core's AC reads: `classifyVerifies` and `readActiveAcs`, for M19's
 * consistency rules 9-11.
 *
 * 0.2.80 — `ac` moved into the `c4s-plugin-ac` envelope and these two functions
 * stayed, so the `ac` module they read is now declared HERE, as a fixture. That
 * is not a workaround: the core function's contract is "read the type called
 * `ac` off the projection, honouring its own default predicate", and it has to
 * hold for whatever schema the contributing envelope declares. A test that
 * imported the envelope's real schema would be asserting the core against one
 * particular contributor — and could not, since the root test program must not
 * pull `@c4s/plugin-runtime` into itself.
 *
 * ── Existence, for a type that ships no entity service (0.2.9, brief item 25) ──
 *
 * `entityExists` resolved the type's REGISTERED SERVICE and called `getBySlug`.
 * That was true enough while every active type shipped one; it stopped being true
 * the moment a type could declare `data.schema` and register nothing — and then
 * the method answered `false` for entities sitting in their own table.
 *
 * The blast radius is why the fix is on the host rather than in one type:
 * `section-indexer` uses this check to decide whether an `<inline_mention/>`
 * becomes a `section_entity` row, `entities-router` to decide 404, the reference
 * tools to resolve a target. Every one of them was wrong in the same way for the
 * same types, so the AC case below is one symptom of a class, and both are pinned
 * here together.
 */

import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/test-db.js';
import { acFixtureModule } from '../../../../tests/helpers/ac-fixture.js';
import { classifyVerifies, readActiveAcs } from './ac-rules.js';
import { applyProjection } from '../../db/projection.js';
import { RawEntityReader } from '../raw-entity-reader.js';
import { PluginRegistryImpl } from '../../core/plugin-host/registry.js';
import type { BackendModule, ProjectPluginHost } from '../../core/plugin-host/types.js';
import {
  SKETCH_FIXTURE_DATA,
  SKETCH_FIXTURE_SLUG_PATTERN,
  fixtureModule,
} from '../../../../tests/helpers/fixture-module.js';

/**
 * A type that declares its data and registers no `EntityService`.
 *
 * It was `design-system` until 0.2.18 moved that type into the
 * `c4s-plugin-frontend-mockups` envelope, then `diagram` until 2.1.63 moved that
 * one into its prebuilt envelope. The host test type `sketch` is the same shape
 * for this test's purposes — and it is the host's own, so no contributor moving
 * out can take it away again.
 */
const sketchModule: BackendModule = fixtureModule('sketch', {
  data: SKETCH_FIXTURE_DATA,
  slugPattern: SKETCH_FIXTURE_SLUG_PATTERN,
});

/**
 * A REAL host holding `module` — with its projection generated, its index wired
 * and, deliberately, no entity service registered. `mount` is never called,
 * which is exactly the shape of a type that declares its data and contributes
 * no service.
 */
function serviceLessHost(db: ReturnType<typeof createTestDb>, module: BackendModule): ProjectPluginHost {
  const registry = new PluginRegistryImpl();
  registry.registerEntityModule(module);
  const host = registry.consolidate(null);
  applyProjection(db, host.listAvailable());
  host.setRawReader(new RawEntityReader(db, host));
  return host;
}

describe('ProjectPluginHost.entityExists', () => {
  it('falls back to the projection row when the type registered no service', () => {
    const db = createTestDb();
    try {
      const host = serviceLessHost(db, sketchModule);
      expect(host.getEntityService('sketch')).toBeNull();

      expect(host.entityExists('sketch', 'flow')).toBe(false);
      db.prepare("INSERT INTO sketch (slug, title, body) VALUES ('flow', 'flow', 'a body')").run();
      expect(host.entityExists('sketch', 'flow')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is false for a type with no table and no service', () => {
    const db = createTestDb();
    try {
      const host = serviceLessHost(db, sketchModule);
      expect(host.entityExists('nope', 'x')).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe('classifyVerifies', () => {
  const hostOver = (db: ReturnType<typeof createTestDb>): ProjectPluginHost =>
    serviceLessHost(db, sketchModule);

  it('accepts a reference to an indexed entity whose type has no entity service', () => {
    const db = createTestDb();
    try {
      const host = hostOver(db);
      db.prepare("INSERT INTO sketch (slug, title, body) VALUES ('flow', 'flow', 'a body')").run();
      expect(classifyVerifies(host, [{ type: 'sketch', slug: 'flow' }])).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('still reports a reference to a slug that is not in the table', () => {
    const db = createTestDb();
    try {
      expect(classifyVerifies(hostOver(db), [{ type: 'sketch', slug: 'ghost' }])).toEqual([
        { type: 'sketch', slug: 'ghost', reason: 'missing' },
      ]);
    } finally {
      db.close();
    }
  });

  it('keeps unknown and inactive ahead of the existence check', () => {
    // Both look like an absent table to a table-based check, and collapsing them
    // would turn a disabled plugin into a corpus full of "unknown type" refs.
    const db = createTestDb();
    try {
      const registry = new PluginRegistryImpl();
      registry.registerEntityModule(sketchModule);
      // Whitelist a type that is not this one: `sketch` stays AVAILABLE but
      // not active.
      const host = registry.consolidate({ entities: ['ac'] } as never);
      applyProjection(db, host.listAvailable());
      host.setRawReader(new RawEntityReader(db, host));

      db.prepare("INSERT INTO sketch (slug, title, body) VALUES ('flow', 'flow', 'a body')").run();
      expect(classifyVerifies(host, [{ type: 'sketch', slug: 'flow' }])).toEqual([
        { type: 'sketch', slug: 'flow', reason: 'inactive' },
      ]);
      expect(classifyVerifies(host, [{ type: 'nope', slug: 'x' }])).toEqual([
        { type: 'nope', slug: 'x', reason: 'unknown' },
      ]);
    } finally {
      db.close();
    }
  });
});

/**
 * A REAL reader over a REAL generated projection.
 *
 * That is the whole point of this block. `readActiveAcs` originally reached
 * `verifies` through `reader.readCollection`, which is the accessor for a
 * PROJECTED collection — and `ac.verifies` declares no `keyFields`, so it stays
 * embedded JSON on the `ac.verifies` column. `readCollection` queried a
 * non-existent `ac_verifies` table, the reader swallowed the `no such table`
 * error, and every AC came back with `verifies: []`.
 *
 * Silently, and with consequences two layers away: `check_consistency` built its
 * `coveredByVerifies` set from nothing, so it reported every entity in the spec
 * as lacking AC coverage and never reported a broken verify.
 *
 * A fake reader could not catch it — it can only ever confirm the caller's own
 * belief about the storage layout, which is exactly what was wrong.
 */
function readerOver(db: ReturnType<typeof createTestDb>): RawEntityReader {
  const registry = new PluginRegistryImpl();
  registry.registerEntityModule(acFixtureModule);
  const host = registry.consolidate(null);
  applyProjection(db, host.listAvailable());
  return new RawEntityReader(db, host);
}

const insertAc = (
  db: ReturnType<typeof createTestDb>,
  slug: string,
  title: string,
  status: string,
  verifies: unknown,
) =>
  db
    .prepare('INSERT INTO ac (slug, title, kind, status, verifies) VALUES (?, ?, ?, ?, ?)')
    .run(slug, title, 'requirement', status, JSON.stringify(verifies));

describe('readActiveAcs', () => {
  it('reads the embedded verifies collection off the row', () => {
    const db = createTestDb();
    try {
      const reader = readerOver(db);
      insertAc(db, 'ac-1', 'the endpoint answers', 'active', [
        { type: 'endpoint', slug: 'get-users' },
        { type: 'dto', slug: 'user-dto' },
      ]);

      const [ac] = readActiveAcs(reader);
      expect(ac?.verifies).toEqual([
        { type: 'endpoint', slug: 'get-users' },
        { type: 'dto', slug: 'user-dto' },
      ]);
      expect(ac?.title).toBe('the endpoint answers');
      expect(ac?.kind).toBe('requirement');
    } finally {
      db.close();
    }
  });

  it('applies the declared status default, and reports no verifies as empty', () => {
    const db = createTestDb();
    try {
      const reader = readerOver(db);
      insertAc(db, 'ac-active', 'still true', 'active', []);
      insertAc(db, 'ac-gone', 'no longer true', 'deprecated', [{ type: 'endpoint', slug: 'x' }]);

      // `deprecated` is out — from the type's own `defaultPredicate`, not from a
      // literal restated here.
      const acs = readActiveAcs(reader);
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
      insertAc(db, 'ac-1', 'mixed', 'active', [
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
