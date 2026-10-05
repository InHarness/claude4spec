import crypto from 'node:crypto';
import { DomainError } from './tags.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import {
  anchorLineIndexOf,
  liveAnchorValues,
  parseSections,
  type ParsedSection,
  type SectionParseResult,
} from '../../shared/section-parser.js';
import type { MatchPosition, PositionResolver } from './text-edits.js';

/**
 * M06 — the section walk over markdown TEXT, shared by every artifact kind that
 * addresses sections by anchor.
 *
 * ## Why this file exists
 *
 * These functions were private to `page-write.ts` while pages were the only
 * thing with anchored sections. 0.2.43 gives `update_plan` the same five-action
 * section vocabulary, and a plan resolves its anchors by scanning its own file
 * (plans are deliberately absent from `section_index`). Two walks with two
 * slightly different end rules is exactly the drift the section index and the
 * write path spent a release removing — so the walk lives here once and both
 * write paths import it.
 *
 * Everything here is PURE: `lines: string[]` in, values out. No filesystem, no
 * database, no artifact kind. What is page-specific stays in `page-write.ts`
 * (the `section_index` lookup, the `ANCHOR_LOSS` guard, the frontmatter
 * coordinate translation); what is plan-specific stays in `plan-write.ts`.
 */

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Positions for a `MATCH_COUNT_MISMATCH` raised inside one section.
 *
 * The anchor is known outright — it is the section the caller addressed — and
 * the line is counted within the subtree, which is the frame the caller was
 * looking at when it wrote the pattern.
 */
export function subtreePositionResolver(anchor: string): PositionResolver {
  return (offset, sourceText): MatchPosition => ({
    anchor,
    line: sourceText.slice(0, offset).split('\n').length,
  });
}

/**
 * Positions for a `MATCH_COUNT_MISMATCH` raised over a WHOLE artifact body.
 *
 * The counterpart to {@link subtreePositionResolver}: there the anchor is known
 * outright because the caller addressed one section, here it has to be found —
 * the hit can land in any section, or between them (`anchor: null` for text
 * above the first heading).
 *
 * `lineOffset` is how many lines precede `bodyText` in the text the ENGINE was
 * handed, which is the coordinate `offset` speaks: a page runs its `textEdits`
 * over the whole file, frontmatter included, while its anchors live in the body,
 * so it reports the line a caller would count in the file and translates to find
 * the section. A plan passes 0 because its body IS that text. Counting lines off
 * `bodyText` instead would shift a page's answer by the height of its
 * frontmatter.
 *
 * Innermost section wins: a hit inside a nested subsection names that
 * subsection, not its parent, which is the anchor a caller would address to
 * narrow the next attempt.
 */
export function bodyPositionResolver(bodyText: string, lineOffset = 0): PositionResolver {
  const ranges = sectionRanges(bodyText.split('\n'));
  return (offset, sourceText): MatchPosition => {
    const sourceLine = sourceText.slice(0, offset).split('\n').length - 1;
    const bodyLine = sourceLine - lineOffset;
    const containing = ranges.filter((r) => bodyLine >= r.lineStart - 1 && bodyLine < r.lineEnd);
    const innermost = containing.reduce<{ anchor: string; lineStart: number } | null>(
      (best, r) => (best === null || r.lineStart > best.lineStart ? r : best),
      null,
    );
    return { anchor: innermost?.anchor ?? null, line: sourceLine + 1 };
  };
}

/** A half-open run of 0-based line indices touched by a substitution. */
export interface LineSpan {
  from: number;
  to: number;
}

/**
 * The anchors whose IDENTITY LINE falls inside one of the spans — the anchor
 * comment when a heading has one, the heading line itself when it does not.
 *
 * Identity line rather than "anywhere in the section", and the difference is the
 * whole point of a differential write's narrower scope: substituting a word in
 * the middle of a section touches no identity at all, so it neither drops an
 * anchor nor earns the right to declare one droppable. An anchor is at risk from
 * exactly one thing — a `find` that swallows the comment carrying it.
 */
export function anchorsInLineSpans(lines: readonly string[], spans: readonly LineSpan[]): string[] {
  const covered = (line: number) => spans.some((s) => line >= s.from && line <= s.to);
  const out: string[] = [];
  for (const sec of parseBody(lines).sections) {
    if (!sec.anchor || out.includes(sec.anchor)) continue;
    if (covered(anchorLineIndexOf(lines, sec) ?? sec.headingLine - 1)) out.push(sec.anchor);
  }
  return out;
}

/**
 * Every anchor VALUE carried by an anchor comment line in this text, in order,
 * duplicates included.
 *
 * Line-wise rather than a free scan of the string: an anchor comment is a LINE,
 * and a value mentioned mid-sentence is prose about an anchor, not one.
 *
 * 2.0.0 — fences ARE tracked now, because the section parser tracks them: an
 * anchor-shaped line inside a code block is an example, never an anchor. It is
 * not indexed, not an orphan, and it does not count toward `dropAnchors` — a
 * page documenting the anchor syntax with a real value in a fence is no longer
 * refused. Duplicates are kept because the answer is used as a multiset — a
 * value that leaves a range and re-enters it is a net zero, and collapsing the
 * two would report a move as an addition.
 */
export function anchorValuesIn(text: string): string[] {
  return liveAnchorValues(text);
}

/**
 * THE parse of a body (no frontmatter) — every walk in this file reads its
 * headings, anchors and boundaries from the shared section parser (M06, 2.0.0).
 */
export function parseBody(lines: readonly string[] | string): SectionParseResult {
  const text = typeof lines === 'string' ? lines : lines.join('\n');
  return parseSections(text, { frontmatter: false });
}

/** Anchored sections, first occurrence of an anchor only — the indexer's collision rule. */
export function claimedSections(parsed: SectionParseResult): ParsedSection[] {
  const claimed = new Set<string>();
  return parsed.sections.filter((sec) => {
    if (!sec.anchor || claimed.has(sec.anchor)) return false;
    claimed.add(sec.anchor);
    return true;
  });
}

/**
 * Every anchored section's line range in THESE lines, in document order — the
 * walk `liveRangeOf` used to do for one anchor, done once for all of them.
 *
 * Factored out because the anchor delta needs the ranges of every section, not
 * of one; running the same walk twice with two slightly different end rules is
 * how the section index and the write path would drift apart again.
 */
export function sectionRanges(
  lines: readonly string[],
): Array<{ anchor: string; lineStart: number; lineEnd: number; level: number }> {
  /**
   * Hand-authored anchors are unpoliced, so the same value can appear twice on
   * one page. The indexer settles that — first occurrence owns the anchor, the
   * rest get no row — and this has to agree with it, not merely resemble it:
   * the batch engine takes the first match, so a delta keyed on the last one
   * would report a section the splice never touched and the index does not own.
   *
   * `lineEnd` is the SUBTREE end (1-based inclusive = 0-based exclusive).
   */
  return claimedSections(parseBody(lines)).map((sec) => ({
    anchor: sec.anchor!,
    lineStart: sec.headingLine,
    lineEnd: sec.subtreeEndLine,
    level: sec.level,
  }));
}

/**
 * Digest of each section's OWN text — its lines down to the next heading of any
 * level, descendants excluded.
 *
 * Not the index's range rule, and deliberately so. A section's indexed range
 * runs to the next heading of equal-or-higher level, so it CONTAINS its
 * subsections: under that rule, editing a paragraph three levels down also
 * "changes" every ancestor up to the page's title, and a caller asking which
 * anchors moved would be handed its own ancestry every time. An ancestor
 * containing your edit is the one thing you could have predicted, which is
 * exactly what this answer is not for.
 */
export function sectionDigests(body: string): Map<string, string> {
  const lines = body.split('\n');
  const parsed = parseBody(lines);
  const out = new Map<string, string>();
  for (const sec of claimedSections(parsed)) {
    out.set(sec.anchor!, sha256(lines.slice(sec.headingLine, sec.ownEndLine).join('\n')));
  }
  return out;
}

/**
 * Which anchors a write actually moved: added, removed, or textually changed.
 *
 * The specification declares the FIELDS (`changedAnchors`, `affectedAnchors`)
 * without defining what belongs in them, so this is the reading the echo-free
 * rule implies — a write reports "what the caller could not have predicted" —
 * filed back as a clarification patch.
 *
 * Order is the after-state's document order, with anchors that disappeared
 * appended in their old document order: a removed anchor has no position in a
 * page it is no longer on, and dropping it entirely would hide the one change a
 * caller is least able to infer.
 */
export function anchorDelta(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = [...after.keys()].filter((a) => before.get(a) !== after.get(a));
  const removed = [...before.keys()].filter((a) => !after.has(a));
  return [...changed, ...removed];
}

/**
 * 0.2.100 — the four shapes of heading text that are a bad argument, refused
 * BEFORE the write, for the whole batch.
 *
 * One function, called by both operations, because the reason is the operation's
 * and not the channel's: each of these describes a line the indexer would not
 * read back as exactly one heading of this section. A newline makes two lines
 * out of one; a leading `#` would be counted into the level the caller was told
 * it does not supply; an anchor comment in the text mints a second identity on
 * the heading line itself; and an empty text leaves a bare `##` that owns no
 * name at all.
 *
 * `INVALID_ARGUMENT`, not a new code, and 400 rather than 409 for a reason worth
 * stating: every one of these refusals is deterministic. Replaying the same text
 * against a refreshed hash refuses identically, so there is nothing for the
 * caller to re-read — the repair is in the request.
 */
export function assertHeadingText(heading: unknown, anchor: string): string {
  if (typeof heading !== 'string') {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `edit for '${anchor}' requires heading for action 'rename'`,
      'heading is the new heading as plain text — one line, no leading `#`',
    );
  }
  if (heading.includes('\n')) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `heading for '${anchor}' contains a newline — a heading is ONE line`,
      'rename rewrites a single line; to add text below it, use a separate `replace` or `append`',
    );
  }
  const trimmed = heading.trim();
  if (trimmed.startsWith('#')) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `heading for '${anchor}' starts with '#' — pass the TEXT, not the markdown line`,
      'the level is kept from the heading being replaced, so it is never yours to send',
    );
  }
  if (new RegExp(ANCHOR_PATTERN_SOURCE).test(heading)) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `heading for '${anchor}' carries an anchor comment`,
      'the anchor sits on its own line above the heading and rename never touches it',
    );
  }
  if (trimmed === '') {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `heading for '${anchor}' is empty once trimmed`,
      'a section without a heading text has no name; delete it instead',
    );
  }
  return trimmed;
}
