import { DomainError } from './tags.js';
import { anchorLineIndexOf, type ParsedSection } from '../../shared/section-parser.js';
import {
  anchorValuesIn,
  anchorsInLineSpans,
  claimedSections,
  parseBody,
  subtreePositionResolver,
  type LineSpan,
} from './section-text.js';
import { applyTextEdits, preview, type TextEdit } from './text-edits.js';

/**
 * 2.1.7 (M43 "section batch rules", consumed by M06 `update_sections` and M10
 * `update_plan({ edits })`) — ONE engine for a section batch over one body.
 *
 * ## What an element claims
 *
 * Every element of the batch CLAIMS part of the body as it was BEFORE the
 * write, measured once on that text:
 *
 *  - `delete`       — the whole subtree with its anchor block;
 *  - `replace`      — the OWN body: below the heading, above the first child;
 *  - `edit`         — each matched fragment on its own (the match window is the
 *                     subtree from its anchor line, heading included);
 *  - `rename`       — the HEAD: anchor block and heading line, newline included;
 *  - `append`       — a POINT, the end of the own body;
 *  - `insert_after` — a POINT, the end of the subtree.
 *
 * ## Four rules
 *
 *  1. `claimed-spans-disjoint` — two ranges sharing a character, or a point
 *     strictly inside a range, refuse the batch, whether the two elements
 *     address one anchor or different ones. A point on a range's edge is fine.
 *  2. `insertion-order` — inserts sharing a position land innermost first
 *     (`append` before `insert_after` of the same section, a descendant's
 *     `insert_after` before its ancestor's); an insert on a range's edge goes
 *     after a range ending there and before one starting there.
 *  3. `delete-exclusive` — no other element may address an anchor inside a
 *     subtree being deleted, that anchor itself included.
 *  4. `one-action-per-anchor` — at most one element of each action per anchor.
 *
 * Every refusal is `INVALID_ARGUMENT`, names both elements by batch position,
 * anchor and action, and carries the repair. Nothing is written until every
 * element is checked, and the composition is one pass over the original text —
 * claims are disjoint, so no element can move another's coordinates and there
 * is nothing to re-measure.
 */

export type BatchAction = 'replace' | 'append' | 'insert_after' | 'delete' | 'edit' | 'rename';

export interface BatchElement {
  anchor: string;
  action: BatchAction;
  content?: string;
  textEdits?: TextEdit[];
  heading?: string;
}

/** What one element did, for the caller's guards and its `results[]` row. */
export interface BatchElementOutcome {
  /**
   * The anchors this element is allowed to drop (`dropAnchors` domain): the
   * addressed subtree for `delete` and `insert_after`, the anchors whose
   * identity line lies in a matched fragment for `edit`, nothing for `replace`,
   * `append` and `rename`.
   */
  scope: string[];
  /** Anchor values the element's new text carries in, duplicates kept. */
  broughtIn: string[];
  /** Anchor values the element's claimed text carried out, duplicates kept. */
  takenOut: string[];
  /** `edit` only. */
  replacements?: number;
  /** `rename` only — the heading as it stood before the write. */
  previousHeading?: string;
  /**
   * 0-based line, in the text BEFORE the write, where this element's write
   * begins — what {@link attributeDropped} uses to pin an anchor no scope
   * covers (one swallowed by a code block the write opened) to the nearest
   * writer above it.
   */
  writeLine: number;
}

export interface ComposedBatch {
  lines: string[];
  outcomes: BatchElementOutcome[];
}

const OWN_BODY_ACTIONS: ReadonlySet<BatchAction> = new Set(['replace', 'append']);

/**
 * `replace` and `append` write the section's OWN body, so a heading in
 * `content` at or above the section's level would close the section and open a
 * sibling in its place — refused for the whole batch. A deeper heading becomes
 * the section's first child; a heading-shaped line in a code block is code.
 */
export function assertOwnBodyContent(action: BatchAction, content: string, level: number, anchor: string): void {
  const offending = parseBody(content).sections.find((sec) => sec.level <= level);
  if (!offending) return;
  throw new DomainError(
    'INVALID_ARGUMENT',
    `${action} for '${anchor}' carries a level-${offending.level} heading ('${offending.heading}') — at or above the section's own level ${level}`,
    `${action} writes the section's OWN body; deeper headings become its first children. The heading itself changes only through rename; to add a sibling use insert_after`,
  );
}

const label = (i: number, e: BatchElement) => `edits[${i}] (anchor '${e.anchor}', ${e.action})`;

const SAME_ACTION_REPAIR: Record<BatchAction, string> = {
  edit: 'merge the two `textEdits` lists into one element',
  replace: 'concatenate the two `content` values into one element',
  append: 'concatenate the two `content` values into one element',
  insert_after: 'concatenate the two `content` values into one element',
  rename: 'keep one rename',
  delete: 'keep one delete',
};

/**
 * Compose a section batch over `lines` (a body: no frontmatter). Every anchor
 * must already resolve to a section of `lines` — the caller refuses an unknown
 * one with its own code first (`SECTION_NOT_FOUND`, `INDEX_STALE`, …).
 */
export function composeSectionBatch(lines: readonly string[], elements: readonly BatchElement[]): ComposedBatch {
  const parsed = parseBody(lines);
  // First occurrence owns a duplicated anchor — the indexer's collision rule.
  const byAnchor = new Map(claimedSections(parsed).map((sec) => [sec.anchor!, sec] as const));
  const sectionOf = (e: BatchElement): ParsedSection => {
    const sec = byAnchor.get(e.anchor);
    if (!sec) throw new DomainError('SECTION_NOT_FOUND', `section '${e.anchor}' not found`);
    return sec;
  };
  const depthOf = (sec: ParsedSection): number => {
    let d = 0;
    for (let p = sec.parent; p !== null; p = parsed.sections[p]!.parent) d++;
    return d;
  };
  /** 0-based first line of the section's anchor block — the heading when it has none. */
  const headStart = (sec: ParsedSection) => (anchorLineIndexOf(lines, sec) ?? sec.headingLine - 1);
  /** Anchors of the subtree's sections, the addressed one first. */
  const subtreeAnchors = (sec: ParsedSection): string[] =>
    parsed.sections
      .filter((s) => s.anchor && s.headingLine >= sec.headingLine && s.headingLine <= sec.subtreeEndLine)
      .map((s) => s.anchor!)
      .filter((a, i, all) => all.indexOf(a) === i);

  // Rule 4 — one-action-per-anchor.
  const firstOf = new Map<string, number>();
  elements.forEach((e, i) => {
    const key = `${e.anchor}\u0000${e.action}`;
    const prior = firstOf.get(key);
    if (prior === undefined) {
      firstOf.set(key, i);
      return;
    }
    throw new DomainError(
      'INVALID_ARGUMENT',
      `${label(prior, elements[prior]!)} and ${label(i, e)} are two elements of the same action on one anchor — one intention in two pieces`,
      SAME_ACTION_REPAIR[e.action],
    );
  });

  // The heading rule of the own-body actions.
  elements.forEach((e) => {
    if (OWN_BODY_ACTIONS.has(e.action)) assertOwnBodyContent(e.action, e.content ?? '', sectionOf(e).level, e.anchor);
  });

  // Rule 3 — delete-exclusive.
  elements.forEach((d, i) => {
    if (d.action !== 'delete') return;
    const inside = new Set(subtreeAnchors(sectionOf(d)));
    elements.forEach((other, j) => {
      if (j === i || !inside.has(other.anchor)) return;
      throw new DomainError(
        'INVALID_ARGUMENT',
        `${label(j, other)} addresses an anchor inside the subtree ${label(i, d)} deletes`,
        'remove that element; new text in place of the deleted section goes through insert_after on the previous section, or append on the parent when the deleted section was its first child',
      );
    });
  });

  // Offsets over the text with a final newline, so every line carries its own.
  const text = lines.join('\n') + '\n';
  const lineOffsets: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) lineOffsets.push(at);
  const off = (i: number) => (i < lines.length ? lineOffsets[i]! : text.length);
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
  const block = (content: string | undefined) => `${content ?? ''}\n`;

  interface Claim { el: number; start: number; end: number; point: boolean; what: 'subtree' | 'own body' | 'head' | 'match' | 'append point' | 'insert point'; find?: string }
  interface Op { el: number; start: number; end: number; text: string; rank: number; depth: number; actionRank: number }
  const claims: Claim[] = [];
  const ops: Op[] = [];
  const outcomes: BatchElementOutcome[] = [];

  elements.forEach((e, i) => {
    const sec = sectionOf(e);
    const depth = depthOf(sec);
    const start = headStart(sec);
    const headingIdx = sec.headingLine - 1;
    const bodyFrom = sec.headingLine; // 0-based first line below the heading
    const ownEnd = sec.ownEndLine; // 0-based exclusive
    const subtreeEnd = sec.subtreeEndLine; // 0-based exclusive
    const outcome: BatchElementOutcome = { scope: [], broughtIn: [], takenOut: [], writeLine: start };
    switch (e.action) {
      case 'delete': {
        claims.push({ el: i, start: off(start), end: off(subtreeEnd), point: false, what: 'subtree' });
        ops.push({ el: i, start: off(start), end: off(subtreeEnd), text: '', rank: 2, depth, actionRank: 0 });
        outcome.scope = subtreeAnchors(sec);
        outcome.takenOut = anchorValuesIn(lines.slice(start, subtreeEnd).join('\n'));
        break;
      }
      case 'replace': {
        const s = off(bodyFrom);
        const t = off(ownEnd);
        claims.push({ el: i, start: s, end: t, point: false, what: 'own body' });
        outcome.writeLine = bodyFrom;
        // An empty own body makes this a zero-width range: it still ENDS at its point.
        ops.push({ el: i, start: s, end: t, text: block(e.content), rank: t > s ? 2 : 0, depth, actionRank: 0 });
        outcome.broughtIn = anchorValuesIn(e.content ?? '');
        outcome.takenOut = anchorValuesIn(lines.slice(bodyFrom, ownEnd).join('\n'));
        break;
      }
      case 'rename': {
        claims.push({ el: i, start: off(start), end: off(headingIdx + 1), point: false, what: 'head' });
        const s = off(headingIdx);
        ops.push({
          el: i,
          start: s,
          end: s + lines[headingIdx]!.length,
          text: `${'#'.repeat(sec.level)} ${(e.heading ?? '').trim()}`,
          rank: 2,
          depth,
          actionRank: 0,
        });
        outcome.previousHeading = sec.heading;
        outcome.writeLine = headingIdx;
        break;
      }
      case 'append': {
        const p = off(ownEnd);
        claims.push({ el: i, start: p, end: p, point: true, what: 'append point' });
        outcome.writeLine = ownEnd;
        ops.push({ el: i, start: p, end: p, text: block(e.content), rank: 1, depth, actionRank: 0 });
        outcome.broughtIn = anchorValuesIn(e.content ?? '');
        break;
      }
      case 'insert_after': {
        const p = off(subtreeEnd);
        claims.push({ el: i, start: p, end: p, point: true, what: 'insert point' });
        outcome.writeLine = subtreeEnd;
        ops.push({ el: i, start: p, end: p, text: block(e.content), rank: 1, depth, actionRank: 1 });
        outcome.scope = subtreeAnchors(sec);
        outcome.broughtIn = anchorValuesIn(e.content ?? '');
        break;
      }
      case 'edit': {
        const windowText = lines.slice(start, subtreeEnd).join('\n');
        const applied = applyTextEdits(windowText, e.textEdits ?? [], subtreePositionResolver(e.anchor));
        const base = off(start);
        const spans: LineSpan[] = [];
        for (const r of applied.matchRanges) {
          const s = base + r.start;
          const t = base + r.end;
          claims.push({ el: i, start: s, end: t, point: false, what: 'match', find: r.find });
          ops.push({ el: i, start: s, end: t, text: r.replaceWith, rank: t > s ? 2 : 0, depth, actionRank: 0 });
          spans.push({ from: lineAt(s), to: lineAt(Math.max(s, t - 1)) });
        }
        if (spans.length > 0) outcome.writeLine = spans[0]!.from;
        outcome.scope = anchorsInLineSpans(lines, spans);
        outcome.broughtIn = anchorValuesIn(applied.text);
        outcome.takenOut = anchorValuesIn(windowText);
        outcome.replacements = applied.replacements;
        break;
      }
    }
    outcomes.push(outcome);
  });

  // Rule 1 — claimed-spans-disjoint, every collision reported at once.
  const collisions: string[] = [];
  const repairs = new Set<string>();
  const describe = (c: Claim) =>
    c.what === 'match' ? `match '${preview(c.find ?? '')}' (line ${lineAt(c.start) + 1})` : `${c.what} (line ${lineAt(c.start) + 1})`;
  for (let a = 0; a < claims.length; a++) {
    for (let b = a + 1; b < claims.length; b++) {
      const x = claims[a]!;
      const y = claims[b]!;
      if (x.el === y.el) continue; // one edit's own matches are disjoint by the engine's rule
      let hit: boolean;
      if (x.point && y.point) hit = false;
      else if (x.point) hit = y.start < x.start && x.start < y.end;
      else if (y.point) hit = x.start < y.start && y.start < x.end;
      else hit = x.start < y.end && y.start < x.end;
      if (!hit) continue;
      const [first, second] = x.el < y.el ? [x, y] : [y, x];
      collisions.push(
        `${label(first.el, elements[first.el]!)} ${describe(first)} collides with ${label(second.el, elements[second.el]!)} ${describe(second)}`,
      );
      repairs.add(repairFor(x, y, elements));
    }
  }
  if (collisions.length > 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `claims collide (each element claims part of the text as it was before the write): ${collisions.join('; ')}`,
      [...repairs].join('; '),
    );
  }

  // Rule 2 — insertion-order, then one forward pass over the original text.
  ops.sort(
    (p, q) =>
      p.start - q.start ||
      p.rank - q.rank ||
      (p.rank === 1 ? q.depth - p.depth || p.actionRank - q.actionRank : 0) ||
      p.el - q.el,
  );
  let out = '';
  let cursor = 0;
  for (const op of ops) {
    out += text.slice(cursor, op.start) + op.text;
    cursor = Math.max(cursor, op.end);
  }
  out += text.slice(cursor);
  if (out.endsWith('\n')) out = out.slice(0, -1);
  return { lines: out.split('\n'), outcomes };
}

/**
 * `droppedAnchors` per element, in input order, no anchor on two rows. An
 * anchor that left the text goes to the element that actually CARRIED IT OUT
 * (`delete` its subtree, `edit` a matched fragment) before any element that
 * merely declares it in scope — an `insert_after` on a section declares its
 * subtree, yet a child deleted next to it was dropped by the `delete`, not by
 * the insert, whichever of the two the caller listed first.
 */
export function attributeDropped(
  outcomes: readonly BatchElementOutcome[],
  survives: (anchor: string) => boolean,
  /**
   * Every anchor on the artifact BEFORE the write, with its 0-based HEADING
   * line. An anchor lost outside every scope — swallowed by a code block some
   * element's content opened and never closed — is still a drop the caller
   * must hear about: it goes to the nearest element whose write begins above
   * that heading (the first element when none does), after every scoped drop
   * is placed. A rename of the swallowed section itself writes ON the heading,
   * so it is never the one blamed.
   */
  priorAnchors: ReadonlyMap<string, number> = new Map(),
): string[][] {
  const rows = outcomes.map(() => [] as string[]);
  const reported = new Set<string>();
  for (const carriedOutOnly of [true, false]) {
    outcomes.forEach((o, i) => {
      for (const a of o.scope) {
        if (survives(a) || reported.has(a)) continue;
        if (carriedOutOnly && !o.takenOut.includes(a)) continue;
        reported.add(a);
        rows[i]!.push(a);
      }
    });
  }
  const sorted = rows.map((row, i) => row.sort((x, y) => outcomes[i]!.scope.indexOf(x) - outcomes[i]!.scope.indexOf(y)));
  if (outcomes.length === 0) return sorted;
  for (const [a, line] of [...priorAnchors].sort((x, y) => x[1] - y[1])) {
    if (survives(a) || reported.has(a)) continue;
    let owner = -1;
    outcomes.forEach((o, i) => {
      if (o.writeLine < line && (owner < 0 || o.writeLine > outcomes[owner]!.writeLine)) owner = i;
    });
    reported.add(a);
    sorted[Math.max(owner, 0)]!.push(a);
  }
  return sorted;
}

/** The repair path of brief table 1.4, chosen by what collided with what. */
function repairFor(x: { el: number; what: string; point: boolean }, y: { el: number; what: string; point: boolean }, elements: readonly BatchElement[]): string {
  const kinds = new Set([x.what, y.what]);
  const actionOf = (c: { el: number }) => elements[c.el]!.action;
  if (x.what === 'match' && y.what === 'match') return 'overlapping edit matches: combine them into one match';
  if (kinds.has('match') && kinds.has('own body')) return "an edit match lies in the own body a replace rewrites: write the change into that replace's `content`";
  if (kinds.has('match') && kinds.has('head'))
    return 'an edit match touches the head of a renamed section: leave the heading change to rename; if the heading was only context, narrow the `find` to the body';
  if (kinds.has('match') && (x.point || y.point))
    return 'an append/insert_after point lies inside an edit match: narrow the `find` so it ends or starts at the point, or write the insert into `replaceWith`';
  if (actionOf(x) === 'delete' || actionOf(y) === 'delete') return 'nothing else may touch a subtree being deleted: remove the overlapping element';
  return 'split the colliding elements into separate calls';
}
