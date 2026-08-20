import { describe, expect, it } from 'vitest';
import {
  applyArtifactRange,
  budgetArtifactContent,
  readArtifactWindow,
  ARTIFACT_FAMILY_ERROR_CODES,
} from './artifact-read.js';
import { artifactRegistry, type ArtifactKind } from './artifact-registry.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import { DomainError } from './tags.js';

const KINDS: ArtifactKind[] = ['brief', 'patch', 'plan'];
const FILE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');

describe('artifact read family — one window, one taxonomy (0.2.40)', () => {
  it('[ac:ac-get-brief-ma-okno-odczytu-range-i-jaw] range returns the named window, with no sectionIndexed gate to pass', () => {
    // Every artifact kind is `sectionIndexed: false`, so there is nothing the
    // gate could gate: a window is unconditionally the right question here.
    for (const kind of KINDS) expect(artifactRegistry[kind].sectionIndexed).toBe(false);

    expect(applyArtifactRange(FILE, { start: 3, end: 5 }, { kind: 'brief', path: 'b.md' })).toBe(
      'line 3\nline 4\nline 5',
    );
    // No range at all is the whole file — the window is opt-in, not imposed.
    expect(applyArtifactRange(FILE, undefined, { kind: 'brief', path: 'b.md' })).toBe(FILE);
  });

  it('[ac:ac-get-brief-ma-okno-odczytu-range-i-jaw] over-budget content read WITHOUT a range comes back truncated, pointing at range', () => {
    const huge = 'x'.repeat(DEFAULT_BUDGET_CHARS + 5_000);
    const out = budgetArtifactContent(huge, { kind: 'brief', path: 'big.md' });

    expect(out.truncated).toBe(true);
    expect(out.content.length).toBe(DEFAULT_BUDGET_CHARS);
    // The hint is UNCONDITIONAL here, unlike get_page's: a brief has exactly one
    // way to be resumed, so there is no branch that could propose a refused call.
    expect(out.truncationHint).toContain('range');
    expect(out.truncationHint).toContain('big.md');
  });

  it('a window that fits carries no marker — absence of `truncated` is the guarantee it is complete', () => {
    const out = readArtifactWindow(FILE, { start: 1, end: 3 }, { kind: 'plan', path: 'p.md' });
    expect(out.truncated).toBeUndefined();
    expect(out.truncationHint).toBeUndefined();
    expect(out.content).toBe('line 1\nline 2\nline 3');
  });

  it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a range past the end of the file is INVALID_ARGUMENT STATING the size — identically for all three kinds', () => {
    for (const kind of KINDS) {
      let thrown: DomainError | undefined;
      try {
        applyArtifactRange(FILE, { start: 500, end: 600 }, { kind, path: `x.md` });
      } catch (err) {
        thrown = err as DomainError;
      }
      expect(thrown, `${kind} must refuse a window past EOF`).toBeInstanceOf(DomainError);
      // The same code for every kind: none invents its own variant.
      expect(thrown!.code).toBe('INVALID_ARGUMENT');
      // ...and the size is the number that makes the next call obvious. Without
      // it the caller is told "no" and given nothing to correct with — which is
      // exactly what `slice`'s silent clamp to '' does instead.
      expect(thrown!.message).toContain('10 lines');
      expect(thrown!.message).toContain(kind);
    }
  });

  it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a structurally invalid range is refused the same way, for every kind', () => {
    for (const kind of KINDS) {
      for (const range of [{ start: 0, end: 3 }, { start: 5, end: 2 }]) {
        expect(() => applyArtifactRange(FILE, range, { kind, path: 'x.md' })).toThrowError(
          expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
        );
      }
    }
  });

  it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] IMMUTABLE_FIELD stays the family code, shared rather than re-invented per kind', () => {
    expect(ARTIFACT_FAMILY_ERROR_CODES).toContain('IMMUTABLE_FIELD');
    // Every kind's frontmatter contract names what may change; the REFUSAL for
    // everything else is one code, owned by the family.
    for (const kind of KINDS) {
      expect(artifactRegistry[kind].frontmatterContract.mutable.length).toBeGreaterThan(0);
      expect(artifactRegistry[kind].frontmatterContract.immutable.length).toBeGreaterThan(0);
    }
  });

  /**
   * The rule is not "every kind has all four" — it is that every kind has
   * WRITTEN DOWN an answer for all four. `n/a — <reason>` is legal and
   * sufficient; silence is the specification error, because an unrecorded gap
   * is indistinguishable from an unnoticed one.
   */
  it('[ac:ac-kazda-pozycja-rodziny-odczytu-artefak] every kind declares a value for all four positions of the read family', () => {
    const positions = ['list', 'getWithWindow', 'search', 'responseBudget'] as const;
    for (const kind of KINDS) {
      const family = artifactRegistry[kind].readFamily;
      for (const position of positions) {
        const value = family[position];
        expect(typeof value, `${kind}.${position} must be declared`).toBe('string');
        expect(value.trim().length, `${kind}.${position} must not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("[ac:ac-kazda-pozycja-rodziny-odczytu-artefak] the missing brief search is recorded as a named gap, not left silent", () => {
    // This is the point of the rule: `search_briefs` does not exist, and that
    // absence is now a written `n/a` with a reason someone can pick up.
    expect(artifactRegistry.brief.readFamily.search).toMatch(/^n\/a — /);
    expect(artifactRegistry.brief.readFamily.search).toContain('search_briefs');
  });

  it('narrowing happens before measuring, so a small window of a huge file is not reported truncated', () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => `line ${i + 1}`).join('\n');
    const out = readArtifactWindow(huge, { start: 1, end: 3 }, { kind: 'brief', path: 'big.md' });
    expect(out.truncated).toBeUndefined();
    expect(out.content).toBe('line 1\nline 2\nline 3');
  });
});
