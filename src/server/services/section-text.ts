import crypto from 'node:crypto';
import { DomainError } from './tags.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import {
  anchorLineIndexOf,
  liveAnchorValues,
  parseSections,
  type ParsedSection,
  type SectionFileKind,
  type SectionParseResult,
} from '../../shared/section-parser.js';
import { applyTextEdits, preview, type MatchPosition, type PositionResolver, type TextEdit } from './text-edits.js';

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
 * What {@link applySectionEdit} needs of an edit: the action and, for the three
 * that carry one, its content.
 *
 * Structural rather than the page's `SectionEdit` so a plan's edit satisfies it
 * too — the splicer never looks at an anchor, only at what to put where.
 */
export interface SectionSplice {
  action: 'replace' | 'append' | 'insert_after' | 'delete' | 'edit' | 'rename';
  content?: string;
  /**
   * 0.2.100 — `rename` only: the new heading as PLAIN TEXT. Carried here for the
   * shape's sake; the splice itself runs through {@link renameHeading}, which
   * has a previous heading to hand back and therefore cannot be a `void` case.
   */
  heading?: string;
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
export function anchorsInLineSpans(
  lines: string[],
  spans: readonly LineSpan[],
  kind: SectionFileKind = 'md',
): string[] {
  const covered = (line: number) => spans.some((s) => line >= s.from && line <= s.to);
  const out: string[] = [];
  for (const sec of parseBody(lines, kind).sections) {
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
export function parseBody(lines: readonly string[] | string, kind: SectionFileKind = 'md'): SectionParseResult {
  const text = typeof lines === 'string' ? lines : lines.join('\n');
  return parseSections(text, kind, { frontmatter: false });
}

/** Anchored sections, first occurrence of an anchor only — the indexer's collision rule. */
function claimedSections(parsed: SectionParseResult): ParsedSection[] {
  const claimed = new Set<string>();
  return parsed.sections.filter((sec) => {
    if (!sec.anchor || claimed.has(sec.anchor)) return false;
    claimed.add(sec.anchor);
    return true;
  });
}

/**
 * Where the anchored section lives in THESE lines: `[lineStart, lineEnd)`,
 * 1-based start (the heading line), exclusive end — the subtree end, where the
 * next section of equal or higher level begins its anchor block. Read off the
 * shared section parser, the same one that fills `section_index`.
 */
export function liveRangeOf(
  lines: string[],
  anchor: string,
  kind: SectionFileKind = 'md',
): { lineStart: number; lineEnd: number } | null {
  return sectionRanges(lines, kind).find((r) => r.anchor === anchor) ?? null;
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
  lines: string[],
  kind: SectionFileKind = 'md',
): Array<{ anchor: string; lineStart: number; lineEnd: number; level: number }> {
  /**
   * Hand-authored anchors are unpoliced, so the same value can appear twice on
   * one page. The indexer settles that — first occurrence owns the anchor, the
   * rest get no row — and this has to agree with it, not merely resemble it:
   * `liveRangeOf` takes the first match, so a delta keyed on the last one would
   * report a section the splice never touched and the index does not own.
   *
   * `lineEnd` is the SUBTREE end (1-based inclusive = 0-based exclusive): the
   * range of the whole-section actions `replace`, `delete`, `insert_after`,
   * `edit`.
   */
  return claimedSections(parseBody(lines, kind)).map((sec) => ({
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
/**
 * Where a section's OWN text ends: the first heading at or after its body, or
 * the end of its range when it has no descendants. Shared by `append` and by
 * `sectionDigests` so the two cannot drift apart.
 */
export function ownEndOf(
  lines: string[],
  range: { lineStart: number; lineEnd: number },
  /**
   * The parse of `lines`, when the caller already has it. A batch over one page
   * (the read side's `get_sections`, `sectionDigests` below) parses ONCE and
   * asks per section; a single call lets this function parse for itself.
   */
  parsed: SectionParseResult = parseBody(lines),
): number {
  const self = parsed.sections.find((sec) => sec.headingLine === range.lineStart);
  const own = self ? self.ownEndLine : range.lineEnd;
  return Math.min(range.lineEnd, own);
}

export function sectionDigests(body: string, kind: SectionFileKind = 'md'): Map<string, string> {
  const lines = body.split('\n');
  const parsed = parseBody(lines, kind);
  const out = new Map<string, string>();
  for (const sec of claimedSections(parsed)) {
    out.set(sec.anchor!, sha256(lines.slice(sec.headingLine, sec.ownEndLine).join('\n')));
  }
  return out;
}

/**
 * 2.0.0 — `append` may not carry a heading at or above the addressed section's
 * level: it would close the section it was meant to extend and open a sibling
 * (or an ancestor's sibling) in its place. Deeper headings are fine — they
 * become the section's first children. A heading-shaped line in a code block
 * of `content` is code, not a heading. Refused for the whole batch, before the
 * file is touched.
 */
export function assertAppendContent(content: string, level: number, anchor: string): void {
  const offending = parseBody(content).sections.find((sec) => sec.level <= level);
  if (!offending) return;
  throw new DomainError(
    'INVALID_ARGUMENT',
    `append for '${anchor}' carries a level-${offending.level} heading ('${offending.heading}') — at or above the section's own level ${level}`,
    'append adds to the section\'s OWN body; deeper headings become its first children. To add a sibling use insert_after',
  );
}

/** What {@link prepareSubstitutions} needs of a batch entry: where it points and what it does. */
export interface SubstitutionEntry {
  anchor: string;
  action: SectionSplice['action'];
  textEdits?: TextEdit[];
}

/** One `edit` entry's substitutions, measured on the body BEFORE the batch. */
export interface PreparedSubstitution {
  replacements: number;
  /** 0-based line spans of the matched fragments, in the original lines — the entry's anchor scope. */
  spans: LineSpan[];
  /** The addressed subtree as it stood before the batch, and after this entry's own substitutions. */
  subtreeBefore: string;
  subtreeAfter: string;
}

/**
 * 2.1.x — every `edit` entry of a section batch, matched and applied on the
 * body AS THE CALLER READ IT, before any other entry splices.
 *
 * ## Refused on fragments, not on ranges
 *
 * A substitution states a CHANGE, so it may not touch lines another entry of
 * the same batch writes: with the fragment under a `replace` or `delete` the
 * caller could not tell whether the substitution survived, and anywhere else
 * the two entries would be describing the same text twice. What an entry
 * writes is measured on the original lines — `replace` its body, `delete` its
 * subtree with heading and anchor comment, `rename` its heading line,
 * `append`/`insert_after` their insertion POINT, `edit` its matched fragments —
 * and every addressed entry also owns its anchor comment line, so no fragment
 * can eat the address a neighbour in the batch resolves by.
 *
 * Until 2.1.0 the rule was on RANGES: any `edit` nesting with any other entry
 * was refused, so a parent `edit` fixing its own intro alongside a child
 * `replace` lost the whole batch. Only an overlap of the matched text matters.
 *
 * Every collision is reported at once, so one retry is enough.
 *
 * ## No cascade
 *
 * Because all `edit`s are matched here, before anything else splices, a
 * `find` can only ever hit text the caller read — never text the same batch
 * wrote. The substitutions are disjoint (overlaps were just refused), so they
 * are applied together, right to left, over the whole body; the remaining
 * entries then splice bottom-up on ranges re-measured live by anchor, which a
 * changed line count cannot mislead.
 */
export function prepareSubstitutions(
  lines: string[],
  entries: readonly SubstitutionEntry[],
  kind: SectionFileKind = 'md',
): { lines: string[]; byAnchor: Map<string, PreparedSubstitution> } {
  const byAnchor = new Map<string, PreparedSubstitution>();
  if (!entries.some((e) => e.action === 'edit')) return { lines, byAnchor };

  const text = lines.join('\n');
  const lineOffsets: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) lineOffsets.push(at);
  /** Offset of the start of 0-based line `i`; one past the text for the line after the last. */
  const off = (i: number) => (i < lines.length ? lineOffsets[i]! : text.length + 1);
  /** 0-based line holding offset `o` — a binary search over `lineOffsets`, not a re-split of the prefix. */
  const lineAt = (o: number) => {
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineOffsets[mid]! <= o) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const parsed = parseBody(lines, kind);
  const rangeByAnchor = new Map(sectionRanges(lines, kind).map((r) => [r.anchor, r]));

  interface Fragment { start: number; end: number; find: string; replaceWith: string }
  const fragmentsOf = new Map<string, Fragment[]>();
  for (const entry of entries) {
    if (entry.action !== 'edit') continue;
    const range = rangeByAnchor.get(entry.anchor)!;
    const subtreeBefore = lines.slice(range.lineStart, range.lineEnd).join('\n');
    const applied = applyTextEdits(subtreeBefore, entry.textEdits ?? [], subtreePositionResolver(entry.anchor));
    const base = off(range.lineStart);
    const fragments = applied.matchRanges.map((r) => ({
      start: base + r.start,
      end: base + r.end,
      find: r.find,
      replaceWith: r.replaceWith,
    }));
    fragmentsOf.set(entry.anchor, fragments);
    byAnchor.set(entry.anchor, {
      replacements: applied.replacements,
      spans: fragments.map((f) => ({ from: lineAt(f.start), to: lineAt(f.end) })),
      subtreeBefore,
      subtreeAfter: applied.text,
    });
  }

  /**
   * What an entry writes, in character offsets of the original body. A point
   * has `start === end`. `address` marks the anchor comment line every
   * addressed entry owns — checked in BOTH directions between two `edit`s,
   * unlike their fragments, whose overlap is symmetric and reported once.
   */
  interface Written { start: number; end: number; what: string; address?: true }
  const writtenBy = (entry: SubstitutionEntry): Written[] => {
    const range = rangeByAnchor.get(entry.anchor)!;
    const self = parsed.sections.find((sec) => sec.headingLine === range.lineStart);
    const anchorIdx = self ? anchorLineIndexOf(lines, self) : null;
    const out: Written[] = [];
    if (anchorIdx !== null) {
      out.push({
        start: off(anchorIdx),
        end: off(anchorIdx + 1),
        what: `touches the anchor comment of '${entry.anchor}', which another entry in this batch addresses (action '${entry.action}')`,
        address: true,
      });
    }
    const lineRange = (from: number, to: number, what: string) =>
      out.push({ start: off(from), end: from === to ? off(from) : off(to), what });
    switch (entry.action) {
      case 'replace':
        lineRange(range.lineStart, range.lineEnd, `lies inside the section '${entry.anchor}' that another entry in this batch replaces`);
        break;
      case 'delete':
        lineRange(anchorIdx ?? range.lineStart - 1, range.lineEnd, `lies inside the section '${entry.anchor}' that another entry in this batch deletes`);
        break;
      case 'rename':
        lineRange(range.lineStart - 1, range.lineStart, `touches the heading of '${entry.anchor}', which another entry in this batch renames`);
        break;
      case 'append': {
        const at = ownEndOf(lines, range, parsed);
        lineRange(at, at, `crosses the point where another entry in this batch appends to '${entry.anchor}'`);
        break;
      }
      case 'insert_after':
        lineRange(range.lineEnd, range.lineEnd, `crosses the point where another entry in this batch inserts after '${entry.anchor}'`);
        break;
      case 'edit':
        for (const f of fragmentsOf.get(entry.anchor) ?? []) {
          out.push({ start: f.start, end: f.end, what: `overlaps a fragment the edit on '${entry.anchor}' also substitutes` });
        }
        break;
    }
    return out;
  };

  const HINT =
    'a substitution may not touch lines another entry in the same batch writes — move that substitution into a separate call, or narrow its find to text no other entry writes';
  const written = entries.map(writtenBy);
  const collisions: string[] = [];
  entries.forEach((entry, i) => {
    if (entry.action !== 'edit') return;
    for (const f of fragmentsOf.get(entry.anchor)!) {
      entries.forEach((other, j) => {
        if (other.anchor === entry.anchor) return;
        for (const w of written[j]!) {
          // Two edits' fragments colliding are one collision, reported once;
          // an edit's anchor comment is guarded whichever of the two came first.
          if (other.action === 'edit' && j < i && !w.address) continue;
          const hit = w.start === w.end ? f.start < w.start && w.start < f.end : f.start < w.end && w.start < f.end;
          if (!hit) continue;
          collisions.push(`edit on '${entry.anchor}': find '${preview(f.find)}' (line ${lineAt(f.start) + 1}) ${w.what}`);
        }
      });
    }
  });
  if (collisions.length > 0) throw new DomainError('INVALID_ARGUMENT', collisions.join('; '), HINT);

  let out = text;
  for (const f of [...fragmentsOf.values()].flat().sort((a, b) => b.start - a.start)) {
    out = out.slice(0, f.start) + f.replaceWith + out.slice(f.end);
  }
  return { lines: out.split('\n'), byAnchor };
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

/**
 * Rewrite the heading LINE of an anchored section, in place, and hand back the
 * text it carried before.
 *
 * The level is read off the line being replaced rather than taken from the
 * caller, so a `##` stays a `##` whatever arrives. The anchor comment sits ABOVE
 * `range.lineStart - 1` and is outside this write entirely — which is the whole
 * point of the action: the label changes, the address does not. The body below
 * is untouched, so `content_hash` (computed over the body alone) does not move
 * either, and the line COUNT is unchanged, so a bottom-up batch walking past
 * this splice finds every other range exactly where it measured it.
 *
 * Returns rather than voids, which is why `applySectionEdit` cannot host it: the
 * previous heading is the one thing in a `rename`'s answer the caller could not
 * have worked out for itself, since it addressed the section by anchor and
 * somebody else may have renamed it since the caller last read.
 */
export function renameHeading(
  lines: string[],
  range: { lineStart: number; lineEnd: number },
  heading: string,
): string {
  const lineIndex = range.lineStart - 1;
  const self = parseBody(lines).sections.find((sec) => sec.headingLine === range.lineStart);
  if (!self) {
    /**
     * Unreachable through either operation: the range came from `liveRangeOf`,
     * which derives it from the same section parse. Kept because a silent
     * no-op here would report a rename that never happened.
     */
    throw new DomainError('INVALID_ARGUMENT', `no heading at line ${range.lineStart} to rename`);
  }
  lines[lineIndex] = `${'#'.repeat(self.level)} ${heading}`;
  return self.heading;
}

/**
 * Splice ONE edit into `lines`, in place.
 *
 * `range.lineStart` is the heading line 1-based, so `lineStart` as a 0-based
 * index is the first line BELOW the heading — which is why `replace` starts
 * there and leaves the heading and its anchor comment (which sits above
 * `lineStart`) untouched.
 */
export function applySectionEdit(
  lines: string[],
  edit: SectionSplice,
  range: { lineStart: number; lineEnd: number },
  /** The page's file kind — the same parse the range came from (`.mdx` excludes unknown JSX). */
  kind: SectionFileKind = 'md',
): void {
  const body = (edit.content ?? '').split('\n');
  switch (edit.action) {
    case 'replace':
      lines.splice(range.lineStart, range.lineEnd - range.lineStart, ...body);
      return;
    case 'append': {
      /**
       * The end of the section's OWN prose — before its first subsection, not
       * after the whole subtree. The range runs to the next heading of
       * equal-or-higher level, so it CONTAINS the descendants; splicing at
       * `lineEnd` would drop an `append` to a parent section underneath its
       * last `###` child, in a different section than the one addressed.
       *
       * Same end rule as `sectionDigests`, which is the point: "this section's
       * own text" has to mean one thing across the file.
       */
      lines.splice(ownEndOf(lines, range, parseBody(lines, kind)), 0, ...body);
      return;
    }
    case 'insert_after':
      /**
       * After the whole subtree — a section's range contains its subsections,
       * so `lineEnd` is exactly that position. For a leaf section this
       * coincides with `append`.
       */
      lines.splice(range.lineEnd, 0, ...body);
      return;
    case 'edit':
      /**
       * Unreachable: `updateSections` applies a substitution itself, because it
       * needs the engine's match ranges for the anchor scope and its count for
       * the result row — neither of which survives a splicer that returns void.
       * The case is here so the switch stays exhaustive over the action union.
       */
      return;
    case 'rename':
      /**
       * Unreachable for the same reason, one release later: both write paths
       * call {@link renameHeading} themselves, because the previous heading text
       * has to reach the result row and a `void` splicer cannot carry it.
       */
      return;
    case 'delete': {
      /**
       * The heading and the anchor comment go too — a section whose heading
       * survived would not have been deleted, and an anchor comment left behind
       * keeps every deep link to the removed section resolving.
       *
       * Which comment belongs to this heading is the section parser's question
       * (`anchorLineIndexOf`) — blank lines between the two are ordinary in a
       * hand-edited file. 2.0.0: the whole SUBTREE goes (`range.lineEnd`).
       */
      const self = parseBody(lines, kind).sections.find((sec) => sec.headingLine === range.lineStart);
      const headingIdx = range.lineStart - 1;
      const anchorIdx = (self && anchorLineIndexOf(lines, self)) ?? headingIdx;
      lines.splice(anchorIdx, range.lineEnd - anchorIdx);
      return;
    }
  }
}
