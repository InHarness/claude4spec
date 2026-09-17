import { describe, expect, it } from 'vitest';
import { bodyPositionResolver } from './section-text.js';
import { applyTextEdits, type MatchCountMismatchError } from './text-edits.js';

/**
 * 0.2.86 — the whole-body position resolver, and the contract it exists for:
 * M43 `match-count-declared` says a mismatch reports its hits as "section
 * anchor + line number", not as a byte offset. `update_plan`'s top-level
 * `textEdits` passed no resolver at all, so every hit came back `anchor: null`
 * and the rule was satisfied in name only.
 */
const BODY = [
  '<!-- anchor: aaaa0001 -->',
  '## Alpha',
  '',
  'shared word here',
  '',
  '<!-- anchor: aaaa0002 -->',
  '### Alpha child',
  '',
  'shared word again',
  '',
  '<!-- anchor: bbbb0001 -->',
  '## Beta',
  '',
  'beta body',
  '',
].join('\n');

describe('bodyPositionResolver', () => {
  it('names the section containing each hit, innermost first', () => {
    try {
      applyTextEdits(BODY, [{ find: 'shared word', replaceWith: 'x' }], bodyPositionResolver(BODY));
      expect.unreachable('two hits against an implied expectedMatches of 1 must refuse');
    } catch (err) {
      const e = err as MatchCountMismatchError;
      expect(e.code).toBe('MATCH_COUNT_MISMATCH');
      expect(e.details[0]).toMatchObject({ expectedMatches: 1, actualMatches: 2 });
      /**
       * The second hit sits under `### Alpha child`, nested inside `## Alpha`.
       * It must name the CHILD: that is the anchor a caller would address to
       * narrow the next attempt, and naming the parent would send it to a
       * subtree containing both hits.
       */
      expect(e.details[0]!.positions).toEqual([
        { anchor: 'aaaa0001', line: 4 },
        { anchor: 'aaaa0002', line: 9 },
      ]);
      expect(JSON.stringify(e.details)).not.toMatch(/offset/);
    }
  });

  it('answers `anchor: null` for a hit above the first heading, not the first section', () => {
    const preamble = ['orphan text', '', '<!-- anchor: cccc0001 -->', '## Gamma', '', 'orphan text', ''].join('\n');
    try {
      applyTextEdits(preamble, [{ find: 'orphan text', replaceWith: 'x' }], bodyPositionResolver(preamble));
      expect.unreachable('two hits must refuse');
    } catch (err) {
      const e = err as MatchCountMismatchError;
      expect(e.details[0]!.positions).toEqual([
        { anchor: null, line: 1 },
        { anchor: 'cccc0001', line: 6 },
      ]);
    }
  });

  it('shifts lines by `lineOffset` while resolving anchors in body coordinates', () => {
    // What a page does: anchors live in the body, the line the caller counts is
    // the line in the FILE, frontmatter included.
    const resolver = bodyPositionResolver(BODY, 5);
    try {
      applyTextEdits(BODY, [{ find: 'shared word', replaceWith: 'x' }], resolver);
      expect.unreachable('two hits must refuse');
    } catch (err) {
      const e = err as MatchCountMismatchError;
      expect(e.details[0]!.positions).toEqual([
        { anchor: 'aaaa0001', line: 9 },
        { anchor: 'aaaa0002', line: 14 },
      ]);
    }
  });
});
