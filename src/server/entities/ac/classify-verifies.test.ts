/**
 * `AcService.classifyVerifies` — what makes a `verifies` reference broken
 * (0.2.9, brief item 25).
 *
 * The check moved off `host.entityExists`, which resolves the target type's
 * REGISTERED SERVICE and calls `getBySlug`, onto `RawEntityReader.getEntity`,
 * which reads the target type's TABLE. The two disagree on exactly one state,
 * and it is the state the declarative contract makes normal: a type that is
 * active and indexed but ships no `backend.service`. Under the old check every
 * AC verifying such a type was reported broken — a corpus-wide false positive
 * arriving the moment a type stopped shipping a service, from a change that
 * touched neither the AC nor its target.
 */

import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/test-db.js';
import { AcService } from './service.js';
import { designSystemBackendModule } from '../design-system/plugin.js';
import type { BackendModule, PluginHost } from '../../core/plugin-host/types.js';
import type { EntityStore } from '../../services/entity-store.js';
import type { TagsService } from '../../services/tags.js';
import type { VersionService } from '../../services/versions.js';

/**
 * A host for which `design-system` is available and active — and has NO entity
 * service, which is the whole point. `entityExists` answers `false` for it; the
 * reader answers from the row.
 */
function serviceLessHost(module: BackendModule): PluginHost {
  return {
    getAvailable: (type: string) => (type === module.type ? module : null),
    getEntity: (type: string) => (type === module.type ? module : null),
    isActive: (type: string) => type === module.type,
    entityExists: () => false,
  } as unknown as PluginHost;
}

function acServiceOver(db: ReturnType<typeof createTestDb>): AcService {
  return new AcService(
    db,
    {} as TagsService,
    {} as VersionService,
    serviceLessHost(designSystemBackendModule),
    {} as EntityStore,
  );
}

describe('AcService.classifyVerifies', () => {
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

  it('keeps unknown and inactive on the host — the reader cannot tell them apart', () => {
    // Both look like an absent table to a table-based check, and collapsing them
    // would turn a disabled plugin into a corpus full of "unknown type" refs.
    const db = createTestDb();
    try {
      const host = {
        getAvailable: (type: string) => (type === 'design-system' ? designSystemBackendModule : null),
        getEntity: () => null,
        isActive: () => false,
        entityExists: () => false,
      } as unknown as PluginHost;
      const service = new AcService(db, {} as TagsService, {} as VersionService, host, {} as EntityStore);

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
