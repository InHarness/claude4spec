import { describe, expect, it } from 'vitest';
import { applyPagesOverride } from './pages-override.js';
import type { Root } from '../../shared/types.js';

const root = (id: string, dir: string, extra: Partial<Root> = {}): Root =>
  ({ id, dir, name: id, sectionIndexed: true, referenceValidated: true, ...extra }) as Root;

describe('applyPagesOverride', () => {
  const roots = [root('pages', 'pages'), root('guides', 'docs/guides'), root('adr', 'docs/adr')];

  it('is a no-op without an override', () => {
    expect(applyPagesOverride(roots, undefined)).toEqual(roots);
  });

  it('REPLACES the root list rather than rewriting one entry', () => {
    // Rewriting the built-in root's dir and leaving the others would still sweep
    // every reference-validated root, reporting paths relative to a root the
    // caller never named.
    const out = applyPagesOverride(roots, 'docs/guides');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('guides');
  });

  it('keeps the owning root verbatim — the override names a DIRECTORY, not a root', () => {
    const out = applyPagesOverride(roots, 'docs/adr');
    expect(out[0]).toEqual(roots[2]);
  });

  it('an ad-hoc directory is NOT reference-validated, and not section-indexed', () => {
    // The regression this pins: the CLI's old copy inherited the built-in root's
    // properties, which claimed validation for a directory nobody had declared —
    // a sweep over an arbitrary folder reported its hits as if the project
    // vouched for them.
    const out = applyPagesOverride(roots, '/tmp/scratch');
    expect(out).toHaveLength(1);
    expect(out[0].dir).toBe('/tmp/scratch');
    expect(out[0].referenceValidated).toBe(false);
    expect(out[0].sectionIndexed).toBe(false);
  });

  it('falls back to the first root when there is no built-in `pages` one, and to nothing when there are none', () => {
    const noBuiltin = [root('guides', 'docs/guides')];
    expect(applyPagesOverride(noBuiltin, '/tmp/x')[0].id).toBe('guides');
    expect(applyPagesOverride([], '/tmp/x')).toEqual([]);
  });
});
