/**
 * The one-time adoption pass, against the REAL corpus it was written for.
 *
 * Two claims worth pinning, because both are easy to get subtly wrong and
 * neither fails loudly:
 *   - it fixes every fk that is merely spelled with underscores, and
 *   - it touches NOTHING else — an unresolvable target stays unresolvable, and
 *     stays a warning. A pass that "helpfully" rewrote those would be silencing
 *     the exact signal the `ref` declaration exists to produce.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script, no types; the shape is asserted here.
import { normalizeFks } from '../../../scripts/normalize-database-table-fks.mjs';

const CORPORA = ['app-spec', 'zbieram-kaucje'] as const;

/** The dangling counts measured on the raw corpus, before any normalisation. */
const EXPECTED_DANGLING: Record<string, number> = { 'app-spec': 9, 'zbieram-kaucje': 15 };

function load(corpus: string): Record<string, Record<string, unknown>> {
  const dir = path.join(import.meta.dirname, 'fixtures', 'corpus', corpus);
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  }
  return out;
}

const fkTargets = (files: Record<string, Record<string, unknown>>) =>
  Object.values(files).flatMap((e) =>
    (Array.isArray(e.columns) ? e.columns : [])
      .map((c: { fk?: { table?: string } }) => c?.fk?.table)
      .filter((t): t is string => typeof t === 'string'),
  );

const danglingCount = (files: Record<string, Record<string, unknown>>) => {
  const slugs = new Set(Object.keys(files));
  return fkTargets(files).filter((t) => !slugs.has(t)).length;
};

describe.each(CORPORA)('fk normalisation — %s', (corpus) => {
  it('starts from the measured number of unresolved references', () => {
    // If this drifts, the fixtures changed and every number below is stale.
    expect(danglingCount(load(corpus))).toBe(EXPECTED_DANGLING[corpus]);
  });

  it('resolves every reference that was only a spelling away', () => {
    const { next } = normalizeFks(load(corpus));
    expect(danglingCount(next)).toBe(0);
  });

  it('is idempotent — a second pass finds nothing', () => {
    const { next } = normalizeFks(load(corpus));
    expect(normalizeFks(next).changes).toEqual([]);
  });

  it('changes only fk.table, never a column name, a type or a count', () => {
    const before = load(corpus);
    const { next } = normalizeFks(before);
    for (const [slug, entity] of Object.entries(next)) {
      const orig = before[slug];
      expect(entity.name).toBe(orig.name);
      expect((entity.columns as unknown[]).length).toBe((orig.columns as unknown[]).length);
      const strip = (e: Record<string, unknown>) =>
        JSON.stringify({
          ...e,
          columns: (e.columns as Array<Record<string, unknown>>).map(({ fk, ...rest }) => rest),
        });
      expect(strip(entity)).toBe(strip(orig));
    }
  });
});

describe('fk normalisation — what it refuses to touch', () => {
  const files = {
    orders: { name: 'orders', columns: [] },
    'order-items': {
      name: 'order_items',
      columns: [
        { name: 'a', fk: { table: 'orders', column: 'id' } }, // already resolves
        { name: 'b', fk: { table: 'order_items', column: 'id' } }, // spelling only
        { name: 'c', fk: { table: 'no_such_table', column: 'id' } }, // genuinely absent
        { name: 'd' }, // no fk at all
      ],
    },
  };

  it('rewrites only the value whose kebab form names a real table', () => {
    const { changes } = normalizeFks(structuredClone(files));
    expect(changes).toEqual([
      { slug: 'order-items', column: 'b', from: 'order_items', to: 'order-items' },
    ]);
  });

  /**
   * The important negative. `no_such_table` → `no-such-table` matches nothing,
   * so it is left alone and keeps warning. Rewriting it would turn a visible
   * broken reference into a differently-spelled broken reference.
   */
  it('leaves a genuinely dangling reference exactly as it found it', () => {
    const { next } = normalizeFks(structuredClone(files));
    const cols = next['order-items'].columns as Array<{ name: string; fk?: { table: string } }>;
    expect(cols.find((c) => c.name === 'c')?.fk?.table).toBe('no_such_table');
    expect(cols.find((c) => c.name === 'd')?.fk).toBeUndefined();
  });
});
