import crypto from 'node:crypto';
import { parseHeadings } from './section-indexer.js';
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
 * What {@link applySectionEdit} needs of an edit: the action and, for the three
 * that carry one, its content.
 *
 * Structural rather than the page's `SectionEdit` so a plan's edit satisfies it
 * too — the splicer never looks at an anchor, only at what to put where.
 */
export interface SectionSplice {
  action: 'replace' | 'append' | 'insert_after' | 'delete' | 'edit';
  content?: string;
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
export function anchorsInLineSpans(lines: string[], spans: readonly LineSpan[]): string[] {
  const covered = (line: number) => spans.some((s) => line >= s.from && line <= s.to);
  const out: string[] = [];
  for (const h of parseHeadings(lines)) {
    if (!h.anchor || out.includes(h.anchor)) continue;
    if (covered(h.anchorLineIndex ?? h.lineIndex)) out.push(h.anchor);
  }
  return out;
}

/**
 * Where the anchored section lives in THESE lines: `[lineStart, lineEnd)`,
 * 1-based start (the heading line), exclusive end — the same pair
 * `section_index` stores, recomputed from the file.
 *
 * The end rule is the indexer's, not an approximation of it: a section runs to
 * the next heading of equal or higher level, and stops at that heading's ANCHOR
 * comment when it has one, so the neighbour's anchor is never inside the range.
 * Duplicating five lines from `section-indexer.ts` would be exactly the drift
 * this release exists to remove, so the parser is imported and only the walk
 * lives here.
 */
export function liveRangeOf(lines: string[], anchor: string): { lineStart: number; lineEnd: number } | null {
  return sectionRanges(lines).find((r) => r.anchor === anchor) ?? null;
}

/**
 * Every anchored section's line range in THESE lines, in document order — the
 * walk `liveRangeOf` used to do for one anchor, done once for all of them.
 *
 * Factored out because the anchor delta needs the ranges of every section, not
 * of one; running the same walk twice with two slightly different end rules is
 * how the section index and the write path would drift apart again.
 */
export function sectionRanges(lines: string[]): Array<{ anchor: string; lineStart: number; lineEnd: number }> {
  const headings = parseHeadings(lines);
  /**
   * Hand-authored anchors are unpoliced, so the same value can appear twice on
   * one page. `buildSections` in the indexer settles that the same way — first
   * occurrence owns the anchor, the rest get no row — and this has to agree with
   * it, not merely resemble it: `liveRangeOf` takes the first match, so a delta
   * keyed on the last one would report a section the splice never touched and
   * the index does not own.
   */
  const claimed = new Set<string>();
  return headings.flatMap((self, idx) => {
    if (!self.anchor || claimed.has(self.anchor)) return [];
    claimed.add(self.anchor);
    let lineEnd = lines.length;
    for (let j = idx + 1; j < headings.length; j++) {
      const next = headings[j]!;
      if (next.level <= self.level) {
        lineEnd = next.anchorLineIndex ?? next.lineIndex;
        break;
      }
    }
    return [{ anchor: self.anchor, lineStart: self.lineIndex + 1, lineEnd }];
  });
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
export function ownEndOf(lines: string[], range: { lineStart: number; lineEnd: number }): number {
  const nextHeading = parseHeadings(lines)
    .map((h) => h.anchorLineIndex ?? h.lineIndex)
    .find((s) => s >= range.lineStart);
  return Math.min(range.lineEnd, nextHeading ?? range.lineEnd);
}

export function sectionDigests(body: string): Map<string, string> {
  const lines = body.split('\n');
  const starts = parseHeadings(lines).map((h) => h.anchorLineIndex ?? h.lineIndex);
  const out = new Map<string, string>();
  for (const r of sectionRanges(lines)) {
    const nextHeading = starts.find((s) => s >= r.lineStart);
    out.set(r.anchor, sha256(lines.slice(r.lineStart, Math.min(r.lineEnd, nextHeading ?? r.lineEnd)).join('\n')));
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
      lines.splice(ownEndOf(lines, range), 0, ...body);
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
    case 'delete': {
      /**
       * The heading and the anchor comment go too — a section whose heading
       * survived would not have been deleted, and an anchor comment left behind
       * keeps every deep link to the removed section resolving.
       *
       * Which comment belongs to this heading is `parseHeadings`' question, and
       * the answer is "the first non-blank line above" — blank lines between the
       * two are ordinary in a hand-edited file. Matching only `headingIdx - 1`
       * would recognize fewer anchors than the indexer does, which is precisely
       * the second answer that helper exists to prevent.
       */
      const headingIdx = range.lineStart - 1;
      let anchorIdx = headingIdx;
      for (let j = headingIdx - 1; j >= 0; j--) {
        const above = (lines[j] ?? '').trim();
        if (above === '') continue;
        if (/^<!--\s*anchor:/.test(above)) anchorIdx = j;
        break;
      }
      lines.splice(anchorIdx, range.lineEnd - anchorIdx);
      return;
    }
  }
}
