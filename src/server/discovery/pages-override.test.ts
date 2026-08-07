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

  it('an ad-hoc directory IS swept, and is not section-indexed', () => {
    /**
     * `referenceValidated` must stay TRUE, and this is the assertion that says
     * why rather than leaving it to a comment: `findReferences` filters roots on
     * exactly this property, so `false` here means the sweep walks nothing and
     * `--pages <dir>` answers "nothing references this" for every directory the
     * project has not already declared — the whole set the flag exists for. The
     * empty answer is indistinguishable from a real one, and it is the answer
     * that authorizes a rename or a delete.
     *
     * `sectionIndexed: false` is the honest half: there is no section index for
     * an undeclared directory, so hits from one carry no `anchor`.
     */
    const out = applyPagesOverride(roots, '/tmp/scratch');
    expect(out).toHaveLength(1);
    expect(out[0].dir).toBe('/tmp/scratch');
    expect(out[0].referenceValidated).toBe(true);
    expect(out[0].sectionIndexed).toBe(false);
  });

  it('falls back to the first root when there is no built-in `pages` one, and to nothing when there are none', () => {
    const noBuiltin = [root('guides', 'docs/guides')];
    expect(applyPagesOverride(noBuiltin, '/tmp/x')[0].id).toBe('guides');
    expect(applyPagesOverride([], '/tmp/x')).toEqual([]);
  });
});
