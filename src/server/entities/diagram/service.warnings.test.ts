import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/test-db.js';
import { TagsService } from '../../services/tags.js';
import { VersionService } from '../../services/versions.js';
import type { EntityStore } from '../../services/entity-store.js';
import { DiagramService } from './service.js';

/**
 * The 0.1.140 CRUD contract for the generic `entity-tools` path: create/update
 * return `{ slug, warnings? }`, with `warnings` OMITTED when there is nothing to
 * say. Warnings are advisory — the row is written either way.
 *
 * `VersionService` is left unwired on purpose: without snapshot deps it falls
 * back to `createVersion`, which is all this suite needs. `EntityStore` is a
 * stub so nothing touches the filesystem.
 */
describe('DiagramService create/update warnings (entity-tools contract)', () => {
  let db: Database.Database;
  let service: DiagramService;

  beforeEach(() => {
    db = createTestDb();
    const store = { persist() {}, remove() {} } as unknown as EntityStore;
    service = new DiagramService(db, new TagsService(db), new VersionService(db), store);
  });

  it('omits warnings entirely for a clean source', async () => {
    const result = await service.create({ slug: 'clean', source: 'flowchart TD\n  A-->B' });
    expect(result).toEqual({ slug: 'clean' });
    expect('warnings' in result).toBe(false);
  });

  it('attaches warnings for a source mermaid cannot parse — and still writes the row', async () => {
    const result = await service.create({ slug: 'broken', source: 'not a diagram at all' });
    expect(result.slug).toBe('broken');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toMatch(/^mermaid source may be invalid: /);
    // The linter never blocks: the entity exists with the source verbatim.
    expect(service.getBySlug('broken')?.source).toBe('not a diagram at all');
  });

  it('update follows the same rule in both directions', async () => {
    await service.create({ slug: 'evolving', source: 'flowchart TD\n  A-->B' });

    const broke = await service.update('evolving', { source: 'not a diagram at all' });
    expect(broke.warnings).toHaveLength(1);

    const fixed = await service.update('evolving', { source: 'flowchart TD\n  A-->B' });
    expect(fixed).toEqual({ slug: 'evolving' });
    expect('warnings' in fixed).toBe(false);
  });

  it('validates the stored source, not the requested one, on a partial update', async () => {
    // `format` alone is updated — the untouched broken source must still warn.
    await service.create({ slug: 'partial', source: 'not a diagram at all' });
    const result = await service.update('partial', { format: 'mermaid' });
    expect(result.warnings).toHaveLength(1);
  });

  it('silently coerces any non-d2 format to mermaid — not rejected, not warned about', async () => {
    const result = await service.create({
      slug: 'coerced',
      // A format the CRUD schema would not admit, forced past it: readFormat maps
      // everything that is not 'd2' onto 'mermaid'.
      format: 'graphviz' as 'mermaid',
      source: 'flowchart TD\n  A-->B',
    });
    expect(result).toEqual({ slug: 'coerced' });
    expect(service.getBySlug('coerced')?.format).toBe('mermaid');
  });

  it('accepts d2 as-is and says nothing about it — d2 is not validated yet', async () => {
    const result = await service.create({ slug: 'later', format: 'd2', source: 'x -> y: hi' });
    expect(result).toEqual({ slug: 'later' });
    expect(service.getBySlug('later')?.format).toBe('d2');
  });

  it('an empty source is a legal placeholder, not a complaint', async () => {
    expect(await service.create({ slug: 'placeholder', source: '' })).toEqual({
      slug: 'placeholder',
    });
  });
});
