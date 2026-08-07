import { describe, expect, it } from 'vitest';
import { applyPagesOverride, OVERRIDE_ROOT_ID } from './pages-override.js';
import type { Root } from '../../shared/types.js';

const root = (id: string, dir: string, extra: Partial<Root> = {}): Root =>
  ({ id, dir, name: id, sectionIndexed: true, referenceValidated: true, ...extra }) as Root;

const PROJECT = '/repo/spec';

describe('applyPagesOverride', () => {
  const roots = [root('pages', 'pages'), root('guides', 'docs/guides'), root('adr', 'docs/adr')];

  it('is a no-op without an override', () => {
    expect(applyPagesOverride(roots, undefined, PROJECT)).toEqual(roots);
  });

  it('REPLACES the root list rather than rewriting one entry', () => {
    // Rewriting the built-in root's dir and leaving the others would still sweep
    // every reference-validated root, reporting paths relative to a root the
    // caller never named.
    const out = applyPagesOverride(roots, 'docs/guides', PROJECT);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('guides');
  });

  it('keeps the owning root verbatim — the override names a DIRECTORY, not a root', () => {
    const out = applyPagesOverride(roots, 'docs/adr', PROJECT);
    expect(out[0]).toEqual(roots[2]);
  });

  it('recognises the owning root through any spelling of the same directory', () => {
    /**
     * Matching by raw string equality on `Root.dir` sent `./pages`, `pages/` and
     * the absolute form to the ad-hoc branch, so the identical query with and
     * without `--pages` came back with and without anchors — the CLI/MCP
     * divergence this module exists to remove. All three are what a shell's
     * tab-completion produces.
     */
    for (const spelling of ['./pages', 'pages/', `${PROJECT}/pages`, 'docs/../pages']) {
      const out = applyPagesOverride(roots, spelling, PROJECT);
      expect(out, spelling).toHaveLength(1);
      expect(out[0]!.id, spelling).toBe('pages');
      expect(out[0]!.sectionIndexed, spelling).toBe(true);
    }
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
     * an undeclared directory.
     */
    const out = applyPagesOverride(roots, 'scratch', PROJECT);
    expect(out).toHaveLength(1);
    expect(out[0].dir).toBe('scratch');
    expect(out[0].referenceValidated).toBe(true);
    expect(out[0].sectionIndexed).toBe(false);
  });

  it('gives the ad-hoc root an id of its OWN, so its hits cannot borrow real anchors', () => {
    /**
     * `sectionIndexed: false` describes the root and does not travel with a hit.
     * `anchorFor` matches `section_index` on `(rootId, pagePath, line)` alone, so
     * an ad-hoc root that kept the built-in id had `drafts/architecture.md`
     * decorated with the anchor of `pages/architecture.md` — sending the caller
     * to `get-sections` for a section of a different file, with nothing in the
     * answer to say so. A distinct id matches no row.
     */
    const out = applyPagesOverride(roots, 'drafts', PROJECT);
    expect(out[0]!.id).toBe(OVERRIDE_ROOT_ID);
    expect(out[0]!.id).not.toBe('pages');
  });

  it('normalizes the dir it hands on, so one spelling reaches PagesService', () => {
    // Otherwise `./drafts` and `drafts` produce different `pagePath` values for
    // the same file.
    expect(applyPagesOverride(roots, './drafts/', PROJECT)[0]!.dir).toBe('drafts');
  });

  it('REFUSES an override that resolves outside the project', () => {
    /**
     * This parameter is no longer a flag the user types at their own shell: it
     * arrives as `?pages=` over HTTP and through the MCP mount. `PageSource`
     * joins it onto the project dir with no containment check of its own, so
     * `../../..` walked and read every markdown file above the project and
     * returned its paths and tag text; deeper still, it is a full-filesystem
     * scan on one request. Config roots are validated; this one was not.
     *
     * Refused rather than clamped — a narrowing silently redirected is the exact
     * failure this parameter exists to prevent.
     */
    for (const escape of ['../..', '/etc', `${PROJECT}/../other`, 'docs/../../elsewhere']) {
      const err = (() => {
        try {
          applyPagesOverride(roots, escape, PROJECT);
          return null;
        } catch (e) {
          return e as { code?: string; hint?: string };
        }
      })();
      expect(err, escape).not.toBeNull();
      expect(err!.code, escape).toBe('INVALID_ARGUMENT');
      expect(err!.hint, escape).toContain('inside the project');
    }
  });

  it('falls back to the first root when there is no built-in `pages` one, and to nothing when there are none', () => {
    const noBuiltin = [root('guides', 'docs/guides')];
    expect(applyPagesOverride(noBuiltin, 'x', PROJECT)[0].id).toBe(OVERRIDE_ROOT_ID);
    expect(applyPagesOverride(noBuiltin, 'x', PROJECT)[0].dir).toBe('x');
    expect(applyPagesOverride([], 'x', PROJECT)).toEqual([]);
  });
});
