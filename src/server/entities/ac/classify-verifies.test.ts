/**
 * Existence, for a type that ships no entity service (0.2.9, brief item 25).
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
import { classifyVerifies } from './classify-verifies.js';
import { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import { PluginRegistryImpl } from '../../core/plugin-host/registry.js';
import { diagramBackendModule } from '../diagram/plugin.js';
import type { BackendModule, ProjectPluginHost } from '../../core/plugin-host/types.js';

/**
 * A REAL host holding `diagram` — with its index wired and, deliberately, no
 * entity service registered.
 *
 * It was `design-system` until 0.2.18 moved that type into the
 * `c4s-plugin-frontend-mockups` envelope, out of the host's reach. `diagram` is
 * the same shape for this test's purposes: a type the host still contributes
 * that registers no `EntityService`. `mount` is never called, which is exactly the
 * shape of a type that declares its data and contributes no service.
 */
function serviceLessHost(db: ReturnType<typeof createTestDb>, module: BackendModule): ProjectPluginHost {
  const registry = new PluginRegistryImpl();
  registry.registerEntityModule(module);
  const host = registry.consolidate(null);
  host.setRawReader(new RawEntityReader(db, host));
  return host;
}

describe('ProjectPluginHost.entityExists', () => {
  it('falls back to the projection row when the type registered no service', () => {
    const db = createTestDb();
    try {
      const host = serviceLessHost(db, diagramBackendModule);
      expect(host.getEntityService('diagram')).toBeNull();

      expect(host.entityExists('diagram', 'flow')).toBe(false);
      db.prepare("INSERT INTO diagram (slug, source) VALUES ('flow', 'graph TD')").run();
      expect(host.entityExists('diagram', 'flow')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is false for a type with no table and no service', () => {
    const db = createTestDb();
    try {
      const host = serviceLessHost(db, diagramBackendModule);
      expect(host.entityExists('nope', 'x')).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe('classifyVerifies', () => {
  const hostOver = (db: ReturnType<typeof createTestDb>): ProjectPluginHost =>
    serviceLessHost(db, diagramBackendModule);

  it('accepts a reference to an indexed entity whose type has no entity service', () => {
    const db = createTestDb();
    try {
      db.prepare("INSERT INTO diagram (slug, source) VALUES ('flow', 'graph TD')").run();
      expect(classifyVerifies(hostOver(db), [{ type: 'diagram', slug: 'flow' }])).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('still reports a reference to a slug that is not in the table', () => {
    const db = createTestDb();
    try {
      expect(classifyVerifies(hostOver(db), [{ type: 'diagram', slug: 'ghost' }])).toEqual([
        { type: 'diagram', slug: 'ghost', reason: 'missing' },
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
      registry.registerEntityModule(diagramBackendModule);
      // Whitelist a type that is not this one: `diagram` stays AVAILABLE but
      // not active.
      const host = registry.consolidate({ entities: ['ac'] } as never);
      host.setRawReader(new RawEntityReader(db, host));

      db.prepare("INSERT INTO diagram (slug, source) VALUES ('flow', 'graph TD')").run();
      expect(classifyVerifies(host, [{ type: 'diagram', slug: 'flow' }])).toEqual([
        { type: 'diagram', slug: 'flow', reason: 'inactive' },
      ]);
      expect(classifyVerifies(host, [{ type: 'nope', slug: 'x' }])).toEqual([
        { type: 'nope', slug: 'x', reason: 'unknown' },
      ]);
    } finally {
      db.close();
    }
  });
});
