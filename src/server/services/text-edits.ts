import { DomainError } from './tags.js';

/**
 * M02 / M06 — the literal substitution engine, in ONE place for both operations.
 *
 * ## Why differential writes exist at all
 *
 * Until 0.2.37 every content write shipped the FULL new text of whatever it
 * addressed: `update_page` a whole body, `update_sections` a whole subtree per
 * edit. Correct, and priced wrong — an agent fixing one word in a
 * two-hundred-line page paid a whole-file payload for it, on every typo.
 *
 * A `TextEdit` describes the change instead of restating the result. The engine
 * is deliberately the DUMBEST thing that can be correct: literal matching, no
 * regex, no whitespace normalisation, no fuzzy anything. Every clever matcher
 * eventually edits a line the caller did not mean, and a write path cannot
 * afford a "close enough".
 *
 * ## One engine, two scopes
 *
 * `update_page` runs it over the whole file (frontmatter included);
 * `update_sections`'s `edit` action runs it over one section's subtree. That is
 * the ONLY difference between them, and it lives in the callers — which is the
 * point of this module existing rather than each operation growing its own.
 */

/** One literal substitution. The shape is identical in both operations, by contract. */
export interface TextEdit {
  /**
   * Searched BYTE FOR BYTE. No regex, no whitespace normalisation — what you
   * send is what has to be there. Zero hits → `FIND_NOT_FOUND`.
   */
  find: string;
  /** Inserted in place of every hit. The empty string DELETES the matched span. */
  replaceWith: string;
  /**
   * The caller's count declaration.
   *
   * A number demands exactly that many hits. `"all"` substitutes every hit
   * without committing to a number. OMITTED means exactly 1 — an invisible
   * default, which is why every channel's description has to spell it out.
   * Anything else → `MATCH_COUNT_MISMATCH`.
   */
  expectedMatches?: number | 'all';
}

/** Where one hit landed, in the coordinates the caller can act on. */
export interface MatchPosition {
  /** The section containing the hit, or null when it falls outside every section. */
  anchor: string | null;
  /** 1-based, counted in the text the engine was handed. */
  line: number;
}

/** A half-open span of `sourceText`, in character offsets. */
export interface MatchRange {
  start: number;
  end: number;
}

export interface TextEditResult {
  text: string;
  /** Total hits substituted across the whole batch. */
  replacements: number;
  /**
   * Every substituted span, measured on the text BEFORE the write, in ascending
   * order. This is what the anchor guards read: the "affected scope" of a
   * differential write is its matched fragments, not the range it was aimed at.
   */
  matchRanges: MatchRange[];
}

/**
 * Resolves an offset to the anchor and line a human can navigate to.
 *
 * Injected rather than imported so this module stays free of the section
 * indexer: `page-write.ts` already owns the `sectionRanges` walk, and a second
 * copy of the end rule here is exactly the drift 0.2.13 spent a release
 * removing. Absent (a plain-text caller, an unindexed root) the position still
 * carries its line.
 */
export type PositionResolver = (offset: number, sourceText: string) => MatchPosition;

/** The fallback resolver — line numbers only, no anchors. */
export const lineOnlyPosition: PositionResolver = (offset, sourceText) => ({
  anchor: null,
  line: sourceText.slice(0, offset).split('\n').length,
});

/**
 * `FIND_NOT_FOUND` — a `find` that matched nothing.
 *
 * 400, not 409, and for `ANCHOR_LOSS`'s reason: the refusal is deterministic.
 * Re-reading the page and replaying the request byte for byte refuses again,
 * forever; the repair is in the REQUEST.
 *
 * `details` carries the NORMALISATION DIAGNOSIS — how many hits the same pattern
 * would have had with whitespace collapsed. Mis-transcribed indentation is the
 * single most common way a literal `find` misses, and "0 hits, but 1 if you fix
 * your spaces" is the difference between a caller correcting itself and a caller
 * concluding the text is not there.
 */
export class FindNotFoundError extends DomainError {
  readonly details: Array<{ find: string; matchesAfterWhitespaceNormalization: number }>;
  constructor(details: Array<{ find: string; matchesAfterWhitespaceNormalization: number }>) {
    const normalized = details.filter((d) => d.matchesAfterWhitespaceNormalization > 0);
    super(
      'FIND_NOT_FOUND',
      `no literal match for ${details.length === 1 ? 'a find pattern' : `${details.length} find patterns`}`,
      normalized.length > 0
        ? 'the same pattern DOES match once whitespace is normalized — your spaces or indentation differ from the file; re-read it and copy the fragment exactly'
        : 're-read the addressed range and copy the fragment to replace verbatim; matching is literal, byte for byte',
    );
    this.name = 'FindNotFoundError';
    this.details = details;
  }
}

/**
 * `MATCH_COUNT_MISMATCH` — the hits found are not the hits declared.
 *
 * Positions travel as ANCHOR + LINE, never as a byte offset: an offset is not
 * something a caller can navigate to, and the whole point of answering with
 * positions is to let them look at what they were about to overwrite. Same 400
 * reasoning as above.
 */
export class MatchCountMismatchError extends DomainError {
  readonly details: Array<{
    find: string;
    expectedMatches: number;
    actualMatches: number;
    positions: MatchPosition[];
  }>;
  constructor(details: MatchCountMismatchError['details']) {
    const first = details[0]!;
    super(
      'MATCH_COUNT_MISMATCH',
      `find pattern matched ${first.actualMatches} time(s), not the declared ${first.expectedMatches}`,
      'narrow the pattern with surrounding context, correct expectedMatches, or pass expectedMatches: "all" to substitute every occurrence',
    );
    this.name = 'MatchCountMismatchError';
    this.details = details;
  }
}

/** Every offset at which `needle` occurs in `haystack`, non-overlapping, left to right. */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    out.push(at);
  }
  return out;
}

/**
 * Collapses every run of whitespace to a single space, for the diagnosis alone.
 *
 * Never used for matching — this is the answer to "why did my pattern miss?",
 * not a second, laxer matcher. Offsets from the collapsed text mean nothing in
 * the real one, which is why only a COUNT comes back.
 */
function whitespaceNormalizedMatches(haystack: string, needle: string): number {
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const flat = collapse(needle);
  if (flat.length === 0) return 0;
  return occurrences(collapse(haystack), flat).length;
}

/**
 * Apply a BATCH of literal substitutions to one text.
 *
 * ## The batch is a SET, not a sequence
 *
 * Every `find` is counted against `sourceText` as it stood BEFORE the call. There
 * is no cascading: the output of one substitution is invisible to the next, so
 * the result never depends on the order the caller happened to list them in.
 * That is what makes a batch reviewable — each line of it means the same thing
 * read alone as read together.
 *
 * The price is that matches may not OVERLAP, and one may not sit INSIDE another:
 * either would make the outcome order-dependent again, so both are
 * `INVALID_ARGUMENT` rather than a documented precedence rule.
 *
 * ## Not idempotent, and that is the contract
 *
 * Replaying a successful call — even with a refreshed `expectedHash` — answers
 * `FIND_NOT_FOUND`, because the text it looked for is gone. Callers should read
 * this as the `delete` class of behaviour, not the `replace` class.
 */
export function applyTextEdits(
  sourceText: string,
  edits: readonly TextEdit[],
  resolvePosition: PositionResolver = lineOnlyPosition,
): TextEditResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'textEdits must be a non-empty array',
      'each entry is { find, replaceWith, expectedMatches? }',
    );
  }

  for (const edit of edits) {
    if (typeof edit?.find !== 'string' || edit.find.length === 0) {
      throw new DomainError('INVALID_ARGUMENT', 'each text edit requires a non-empty `find`');
    }
    if (typeof edit.replaceWith !== 'string') {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `text edit for '${preview(edit.find)}' requires \`replaceWith\` (pass "" to delete the matched text)`,
      );
    }
    if (edit.expectedMatches !== undefined && edit.expectedMatches !== 'all') {
      const n = edit.expectedMatches;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          `expectedMatches must be an integer >= 1 or "all", got ${JSON.stringify(n)}`,
          'omit it to declare exactly one match',
        );
      }
    }
  }

  /**
   * Counting BEFORE refusing anything, so a batch whose patterns all miss is
   * reported in one answer rather than one round-trip per pattern. An agent that
   * has to discover its mistakes one at a time makes the same trip five times.
   */
  const found = edits.map((edit) => ({ edit, offsets: occurrences(sourceText, edit.find) }));

  const missing = found.filter((f) => f.offsets.length === 0);
  if (missing.length > 0) {
    throw new FindNotFoundError(
      missing.map((f) => ({
        find: f.edit.find,
        matchesAfterWhitespaceNormalization: whitespaceNormalizedMatches(sourceText, f.edit.find),
      })),
    );
  }

  const miscounted = found.filter(
    (f) => f.edit.expectedMatches !== 'all' && f.offsets.length !== (f.edit.expectedMatches ?? 1),
  );
  if (miscounted.length > 0) {
    throw new MatchCountMismatchError(
      miscounted.map((f) => ({
        find: f.edit.find,
        expectedMatches: (f.edit.expectedMatches as number | undefined) ?? 1,
        actualMatches: f.offsets.length,
        positions: f.offsets.map((offset) => resolvePosition(offset, sourceText)),
      })),
    );
  }

  const spans = found
    .flatMap(({ edit, offsets }) =>
      offsets.map((start) => ({ start, end: start + edit.find.length, replaceWith: edit.replaceWith })),
    )
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1]!;
    const cur = spans[i]!;
    /**
     * Covers both refusals the contract names. Two patterns overlapping
     * partially and one pattern wholly containing another differ only in where
     * `cur.end` falls, and neither has a defensible outcome — the second edit
     * would be applied to text the first one already claimed.
     */
    if (cur.start < prev.end) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `text edits overlap: '${preview(sourceText.slice(prev.start, prev.end))}' and '${preview(sourceText.slice(cur.start, cur.end))}' cover the same text`,
        'matches in one batch must be disjoint — no pattern may overlap or contain another',
      );
    }
  }

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += sourceText.slice(cursor, span.start) + span.replaceWith;
    cursor = span.end;
  }
  out += sourceText.slice(cursor);

  return {
    text: out,
    replacements: spans.length,
    matchRanges: spans.map(({ start, end }) => ({ start, end })),
  };
}

/** A pattern is arbitrarily long; an error message is not. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}
