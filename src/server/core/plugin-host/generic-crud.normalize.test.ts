/**
 * `normalize` on the generic write path.
 *
 * The declaration lives in `shared/plugin-host/data-schema.ts` and its evaluator
 * is unit-tested beside it. What is only observable HERE is the WIRING — and the
 * wiring is where a re-implementation goes wrong:
 *
 *   - a create normalizes before the row is written, so the stored value is
 *     canonical rather than whatever spelling the caller typed;
 *   - an update normalizes the MERGE, not the patch, so a PATCH that carries the
 *     field and one that does not behave identically;
 *   - normalization runs BEFORE `applyComputedDefaults`, so a derived field
 *     reading a normalized one sees the canonical value;
 *   - an ABSENT key is left absent and filled by the DDL default; a PRESENT
 *     empty string is folded and aliased. Two paths, one result — and it is the
 *     kind of pair that quietly grows a third answer.
 */

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection } from '../../db/projection.js';
import type { WritableModule } from '../../db/projection-write.js';
import { genericCreate, genericUpdate, type GenericCrudDeps } from './generic-crud.js';

const snippet: WritableModule = {
  type: 'snippet',
  payloadVersion: 1,
  slugPattern: [{ op: 'slugify', field: 'title' }],
  slugConflict: 'suffix',
  data: {
    schema: {
      title: { type: 'string', required: true, maxLength: 200 },
      language: {
        type: 'string',
        default: 'text',
        maxLength: 30,
        normalize: {
          case: 'lower',
          aliases: { '': 'text', ts: 'typescript', sh: 'bash', md: 'markdown' },
        },
      },
      code: { type: 'string', required: true, maxLength: 10000 },
      updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    },
  },
} as unknown as WritableModule;

function harness() {
  const db = new Database(':memory:');
  applyProjection(db, [snippet]);

  const row = (slug: string) =>
    db.prepare('SELECT slug, title, language, code FROM snippet WHERE slug = ?').get(slug) as
      | { slug: string; title: string; language: string; code: string }
      | undefined;

  const deps = {
    host: { getEntity: (t: string) => (t === 'snippet' ? snippet : undefined) },
    reader: {
      getEntity: (_t: string, slug: string) => {
        const found = row(slug);
        return found ? { slug: found.slug, type: 'snippet', data: found, tags: [] } : null;
      },
    },
    tags: { assignTags: vi.fn() },
    store: { persist: vi.fn() },
    references: {},
    projection: { db, versions: { captureEntitySnapshot: vi.fn() } },
  } as unknown as GenericCrudDeps;

  return { deps, row };
}

const create = (t: ReturnType<typeof harness>, input: Record<string, unknown>) =>
  genericCreate(t.deps, 'snippet', { code: 'x', ...input }, 'user');

describe('genericCreate — normalize', () => {
  it('folds case and applies the alias table before the row is written', () => {
    const t = harness();
    expect(t.row(create(t, { title: 'A', language: 'TypeScript' }).slug)?.language).toBe('typescript');
    expect(t.row(create(t, { title: 'B', language: 'TS' }).slug)?.language).toBe('typescript');
    expect(t.row(create(t, { title: 'C', language: 'Sh' }).slug)?.language).toBe('bash');
    expect(t.row(create(t, { title: 'D', language: 'MD' }).slug)?.language).toBe('markdown');
  });

  it('stores a value outside the table folded, and does NOT refuse the write', () => {
    const t = harness();
    const { slug } = create(t, { title: 'E', language: 'COBOL' });
    expect(t.row(slug)?.language).toBe('cobol');
  });

  it('an explicit empty string aliases to the default', () => {
    const t = harness();
    expect(t.row(create(t, { title: 'F', language: '' }).slug)?.language).toBe('text');
  });

  it('an ABSENT key is filled by the DDL default, not by normalization', () => {
    const t = harness();
    expect(t.row(create(t, { title: 'G' }).slug)?.language).toBe('text');
  });

  it('does not touch a field that declares no normalize', () => {
    const t = harness();
    const { slug } = create(t, { title: 'Keep My Case', language: 'ts' });
    expect(t.row(slug)?.title).toBe('Keep My Case');
  });
});

describe('genericUpdate — normalize', () => {
  it('normalizes a patch that carries the field', () => {
    const t = harness();
    const { slug } = create(t, { title: 'H', language: 'text' });
    genericUpdate(t.deps, 'snippet', slug, { language: 'TS' }, 'user');
    expect(t.row(slug)?.language).toBe('typescript');
  });

  it('is a no-op on a patch that does not carry it — the stored half is already canonical', () => {
    const t = harness();
    const { slug } = create(t, { title: 'I', language: 'TS' });
    genericUpdate(t.deps, 'snippet', slug, { code: 'changed' }, 'user');
    expect(t.row(slug)?.language).toBe('typescript');
    expect(t.row(slug)?.code).toBe('changed');
  });

  it('is idempotent — re-sending the canonical value changes nothing', () => {
    const t = harness();
    const { slug } = create(t, { title: 'J', language: 'ts' });
    genericUpdate(t.deps, 'snippet', slug, { language: 'typescript' }, 'user');
    expect(t.row(slug)?.language).toBe('typescript');
  });
});

describe('ordering against applyComputedDefaults', () => {
  it('a computedDefault reading a normalized field sees the CANONICAL value', () => {
    // The reason the two steps are ordered rather than merely both present. No
    // shipped type does this today; the order is held so the first one that does
    // is not a debugging session.
    const derived = {
      ...snippet,
      type: 'derived',
      data: {
        schema: {
          ...snippet.data.schema,
          title: {
            type: 'string',
            required: true,
            maxLength: 200,
            computedDefault: [{ op: 'raw', field: 'language' }],
          },
        },
      },
    } as unknown as WritableModule;

    const db = new Database(':memory:');
    applyProjection(db, [derived]);
    const deps = {
      host: { getEntity: () => derived },
      reader: { getEntity: () => null },
      tags: { assignTags: vi.fn() },
      store: { persist: vi.fn() },
      references: {},
      projection: { db, versions: { captureEntitySnapshot: vi.fn() } },
    } as unknown as GenericCrudDeps;

    const { slug } = genericCreate(deps, 'derived', { language: 'TS', code: 'x' }, 'user');
    const row = db.prepare('SELECT title FROM derived WHERE slug = ?').get(slug) as { title: string };
    expect(row.title).toBe('typescript');
  });
});
