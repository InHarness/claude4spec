/**
 * Existence, for a type that ships no entity service (0.2.9, brief item 25).
 *
 * `entityExists` resolved the type's REGISTERED SERVICE and called `getBySlug`.
 * That was true enough while every active type shipped one; it stopped being true
 * the moment a type could declare `data.schema` and register nothing — and then
 * the method answered `false` for entities sitting in their own table.
 *
 * The blast radius is why the fix is on the host rather than in `AcService`:
 * `section-indexer` uses this check to decide whether an `<inline_mention/>`
 * becomes a `section_entity` row, `entities-router` to decide 404, the reference
 * tools to resolve a target. Every one of them was wrong in the same way for the
 * same types, so the AC case below is one symptom of a class, and both are pinned
 * here together.
 */

import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/test-db.js';
import { AcService } from './service.js';
import { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import { PluginRegistryImpl } from '../../core/plugin-host/registry.js';
import { designSystemBackendModule } from '../design-system/plugin.js';
import type { BackendModule, ProjectPluginHost } from '../../core/plugin-host/types.js';
import type { EntityStore } from '../../services/entity-store.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';

/**
 * A REAL host holding `design-system` — with its index wired and, deliberately,
 * no entity service registered. `mount` is never called, which is exactly the
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
      const host = serviceLessHost(db, designSystemBackendModule);
      expect(host.getEntityService('design-system')).toBeNull();

      expect(host.entityExists('design-system', 'brand')).toBe(false);
      db.prepare("INSERT INTO design_system (slug, name) VALUES ('brand', 'Brand')").run();
      expect(host.entityExists('design-system', 'brand')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is false for a type with no table and no service', () => {
    const db = createTestDb();
    try {
      const host = serviceLessHost(db, designSystemBackendModule);
      expect(host.entityExists('nope', 'x')).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe('AcService.classifyVerifies', () => {
  const acServiceOver = (db: ReturnType<typeof createTestDb>): AcService =>
    new AcService(
      db,
      {} as TagsService,
      {} as VersionService,
      serviceLessHost(db, designSystemBackendModule),
      {} as EntityStore,
    );

  it('accepts a reference to an indexed entity whose type has no entity service', () => {
    const db = createTestDb();
    try {
      db.prepare("INSERT INTO design_system (slug, name) VALUES ('brand', 'Brand')").run();
      expect(acServiceOver(db).classifyVerifies([{ type: 'design-system', slug: 'brand' }])).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('still reports a reference to a slug that is not in the table', () => {
    const db = createTestDb();
    try {
      expect(acServiceOver(db).classifyVerifies([{ type: 'design-system', slug: 'ghost' }])).toEqual([
        { type: 'design-system', slug: 'ghost', reason: 'missing' },
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
      registry.registerEntityModule(designSystemBackendModule);
      // Whitelist a type that is not this one: `design-system` stays AVAILABLE
      // but not active.
      const host = registry.consolidate({ entities: ['ac'] } as never);
      host.setRawReader(new RawEntityReader(db, host));
      const service = new AcService(db, {} as TagsService, {} as VersionService, host, {} as EntityStore);

      db.prepare("INSERT INTO design_system (slug, name) VALUES ('brand', 'Brand')").run();
      expect(service.classifyVerifies([{ type: 'design-system', slug: 'brand' }])).toEqual([
        { type: 'design-system', slug: 'brand', reason: 'inactive' },
      ]);
      expect(service.classifyVerifies([{ type: 'nope', slug: 'x' }])).toEqual([
        { type: 'nope', slug: 'x', reason: 'unknown' },
      ]);
    } finally {
      db.close();
    }
  });
});
