/**
 * M06 (2.0.0) — THE section parser. Every projection that splits markdown into
 * sections (section indexer, anchor guard, page diff → release diff, plan
 * writes, brief `insert_after_section`, anchor injection, `check_consistency`
 * rules 7/13/15/16) reads its headings, anchors and boundaries from here and
 * never scans the text itself — so the boundaries in the diff, the index, the
 * plan and the brief cannot drift apart.
 *
 * Pure: no disk, no index, no clock, no randomness. Total and deterministic:
 * every text yields a result and none throws.
 *
 * Excluded ranges (fences, multi-line HTML comments, unknown JSX regions — in
 * EVERY markdown file, 2.1.7) come from the one shared scanner in
 * `code-ranges.ts`; a heading-shaped or anchor-shaped line inside one is
 * content, never structure. The file extension is not an input: a `<Callout>`
 * in a `.md` is raw code to the editor, so it has to be dead text to the server
 * too, or the parser would inject an anchor into it and a slug change would
 * rewrite a tag inside it.
 */
import { scanExcluded } from './code-ranges.js';
import { ANCHOR_LINE_RE } from './anchor-pattern.js';

/** 1-based, inclusive — the `line_start` / `line_end` convention of `section_index`. */
export interface LineRange {
  start: number;
  end: number;
}

export type ExcludedRangeKind = 'fence' | 'jsx' | 'html-comment';

export interface ParsedPreamble {
  /** Reserved key, outside the anchor alphabet. */
  key: typeof PREAMBLE_KEY;
  kind: 'preamble';
  range: LineRange;
}

export interface ParsedSection {
  kind: 'section';
  /** `null` — a heading with no adjacent anchor. */
  anchor: string | null;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  heading: string;
  /** First line of the anchor block; the heading line when there is no anchor. */
  startLine: number;
  headingLine: number;
  /** End of the OWN body: the line before the next section of ANY level. */
  ownEndLine: number;
  /** End of the subtree: the line before the next section of the same or a higher level. */
  subtreeEndLine: number;
  /** Position of the parent in `sections`. */
  parent: number | null;
  /** Position in `sections`. */
  position: number;
}

export interface OrphanAnchor {
  anchor: string;
  line: number;
  reason: 'stacked' | 'end-of-file' | 'not-before-heading';
}

export interface AnchorLineInCode {
  anchor: string;
  line: number;
  adjacentToHeadingLine: boolean;
}

export interface SectionParseResult {
  /** The raw frontmatter block — never YAML-parsed here. */
  frontmatter: { range: LineRange; raw: string } | null;
  /** `null` when absent or whitespace only. */
  preamble: ParsedPreamble | null;
  /** Document order. */
  sections: ParsedSection[];
  excludedRanges: Array<{ kind: ExcludedRangeKind; range: LineRange }>;
  diagnostics: {
    orphanAnchors: OrphanAnchor[];
    anchorLinesInCode: AnchorLineInCode[];
    /** Also a multi-line HTML comment nothing closes (`openLine` — the `<!--` line). */
    unclosedCodeBlocks: Array<{ openLine: number }>;
  };
}

export const PREAMBLE_KEY = '~preamble' as const;

/** The ATX heading shape. Exported so callers classifying a single line agree with the parser. */
export const HEADING_LINE_RE = /^(#{1,6})\s+(.+?)\s*$/;

/** The anchor id on an anchor-shaped line, or null. */
export function anchorOfLine(line: string): string | null {
  const m = ANCHOR_LINE_RE.exec(line);
  return m ? (m[1] ?? null) : null;
}

/**
 * GitHub-style slug of a heading text. 2.0.0 — no longer stored
 * (`section_index.heading_slug` is gone): sections are addressed by anchor, and
 * the slug is derived from `heading_text` where a read still reports it.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function emptyResult(lineCount: number): SectionParseResult {
  return {
    frontmatter: null,
    preamble: lineCount > 0 ? { key: PREAMBLE_KEY, kind: 'preamble', range: { start: 1, end: lineCount } } : null,
    sections: [],
    excludedRanges: [],
    diagnostics: { orphanAnchors: [], anchorLinesInCode: [], unclosedCodeBlocks: [] },
  };
}

function frontmatterEnd(lines: readonly string[]): number | null {
  if ((lines[0] ?? '').trimEnd() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!.trimEnd();
    if (l === '---' || l === '...') return i; // 0-based index of the closing line
  }
  return null;
}

/**
 * The frontmatter lines BETWEEN the fences (the same block `parseSections`
 * reports as `frontmatter`), without paying for a section parse. `[]` when
 * the text has no frontmatter.
 */
export function frontmatterInnerLines(text: string): string[] {
  const lines = text.split('\n');
  const end = frontmatterEnd(lines);
  return end === null ? [] : lines.slice(1, end);
}

export interface ParseOptions {
  /**
   * `false` — `text` is a body already stripped of its frontmatter (a page body
   * as `PagesService.read` returns it, a plan body), so a leading `---` is a
   * thematic break, not a frontmatter fence. Default `true`.
   */
  frontmatter?: boolean;
}

export function parseSections(text: string, opts: ParseOptions = {}): SectionParseResult {
  const lines = text.split('\n');
  try {
    return parse(lines, opts.frontmatter ?? true);
  } catch {
    // Totality: a parser bug must never take a caller down. A page nobody can
    // split is, conservatively, all preamble.
    return emptyResult(lines.length);
  }
}

function parse(lines: string[], withFrontmatter: boolean): SectionParseResult {
  const n = lines.length;
  const fmEnd = withFrontmatter ? frontmatterEnd(lines) : null;
  const bodyFrom = fmEnd === null ? 0 : fmEnd + 1; // 0-based first body line

  // Scan the body only — frontmatter lines are blanked so line numbers hold.
  const scanLines = fmEnd === null ? lines : lines.map((l, i) => (i < bodyFrom ? '' : l));
  const scanText = scanLines.join('\n');
  const lineStarts: number[] = [];
  {
    let off = 0;
    for (const l of scanLines) {
      lineStarts.push(off);
      off += l.length + 1;
    }
  }
  /** 0-based line index containing char offset `off`. */
  const lineAt = (off: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const scan = scanExcluded(scanText);
  const excludedRanges: SectionParseResult['excludedRanges'] = [];
  /** Per line: the kind of excluded region covering its first non-space char, or null. */
  const excludedKind: Array<ExcludedRangeKind | null> = new Array(n).fill(null);
  for (const r of scan.regions) {
    const startLine = lineAt(r.start);
    const endLine = lineAt(Math.max(r.start, r.end - 1));
    excludedRanges.push({ kind: r.kind, range: { start: startLine + 1, end: endLine + 1 } });
    for (let i = startLine; i <= endLine; i++) {
      const line = scanLines[i]!;
      const lead = line.length - line.trimStart().length;
      const off = lineStarts[i]! + lead;
      if (off >= r.start && off < Math.max(r.end, r.start + 1)) excludedKind[i] = excludedKind[i] ?? r.kind;
    }
  }

  // Headings, with the anchor block above each.
  interface Raw {
    level: 1 | 2 | 3 | 4 | 5 | 6;
    heading: string;
    headingIdx: number;
    anchor: string | null;
    blockStart: number | null;
  }
  const raws: Raw[] = [];
  /** 0-based anchor lines that own a heading, and those stacked over one. */
  const owning = new Set<number>();
  const stacked = new Set<number>();
  for (let i = bodyFrom; i < n; i++) {
    if (excludedKind[i] !== null) continue;
    const m = HEADING_LINE_RE.exec(lines[i]!);
    if (!m) continue;
    let anchor: string | null = null;
    let blockStart: number | null = null;
    for (let j = i - 1; j >= bodyFrom; j--) {
      if (excludedKind[j] !== null) break;
      const above = lines[j]!;
      if (above.trim() === '') continue;
      const a = anchorOfLine(above);
      if (a === null) break;
      if (anchor === null) {
        anchor = a;
        owning.add(j);
      } else {
        stacked.add(j);
      }
      blockStart = j;
    }
    raws.push({
      level: m[1]!.length as Raw['level'],
      heading: m[2]!.trim(),
      headingIdx: i,
      anchor,
      blockStart,
    });
  }

  // Boundaries and hierarchy.
  const sections: ParsedSection[] = [];
  const stack: number[] = [];
  for (let p = 0; p < raws.length; p++) {
    const r = raws[p]!;
    while (stack.length && raws[stack[stack.length - 1]!]!.level >= r.level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1]! : null;
    stack.push(p);
    const startIdx = r.blockStart ?? r.headingIdx;
    const next = raws[p + 1];
    const ownEndIdx = next ? (next.blockStart ?? next.headingIdx) - 1 : n - 1;
    let subtreeEndIdx = n - 1;
    for (let q = p + 1; q < raws.length; q++) {
      if (raws[q]!.level <= r.level) {
        subtreeEndIdx = (raws[q]!.blockStart ?? raws[q]!.headingIdx) - 1;
        break;
      }
    }
    sections.push({
      kind: 'section',
      anchor: r.anchor,
      level: r.level,
      heading: r.heading,
      startLine: startIdx + 1,
      headingLine: r.headingIdx + 1,
      ownEndLine: ownEndIdx + 1,
      subtreeEndLine: subtreeEndIdx + 1,
      parent,
      position: p,
    });
  }

  // Preamble — between frontmatter and the first section.
  let preamble: ParsedPreamble | null = null;
  const preEndIdx = sections.length ? sections[0]!.startLine - 2 : n - 1;
  if (preEndIdx >= bodyFrom) {
    const hasContent = lines.slice(bodyFrom, preEndIdx + 1).some((l) => l.trim() !== '');
    if (hasContent) {
      preamble = { key: PREAMBLE_KEY, kind: 'preamble', range: { start: bodyFrom + 1, end: preEndIdx + 1 } };
    }
  }

  // Diagnostics.
  const orphanAnchors: OrphanAnchor[] = [];
  const anchorLinesInCode: AnchorLineInCode[] = [];
  for (let i = bodyFrom; i < n; i++) {
    const a = anchorOfLine(lines[i]!);
    if (a === null) continue;
    if (excludedKind[i] !== null) {
      if (excludedKind[i] === 'fence') {
        let k = i + 1;
        while (k < n && excludedKind[k] === 'fence' && lines[k]!.trim() === '') k++;
        const adjacent = k < n && excludedKind[k] === 'fence' && HEADING_LINE_RE.test(lines[k]!.trimStart());
        anchorLinesInCode.push({ anchor: a, line: i + 1, adjacentToHeadingLine: adjacent });
      }
      continue;
    }
    if (owning.has(i)) continue;
    if (stacked.has(i)) {
      orphanAnchors.push({ anchor: a, line: i + 1, reason: 'stacked' });
      continue;
    }
    let k = i + 1;
    while (k < n && excludedKind[k] === null && (lines[k]!.trim() === '' || anchorOfLine(lines[k]!) !== null)) k++;
    orphanAnchors.push({ anchor: a, line: i + 1, reason: k >= n ? 'end-of-file' : 'not-before-heading' });
  }

  const frontmatter =
    fmEnd === null ? null : { range: { start: 1, end: fmEnd + 1 }, raw: lines.slice(0, fmEnd + 1).join('\n') };

  return {
    frontmatter,
    preamble,
    sections,
    excludedRanges,
    diagnostics: {
      orphanAnchors,
      anchorLinesInCode,
      unclosedCodeBlocks: scan.unclosed.map((b) => ({ openLine: b.startLine })),
    },
  };
}

// ── Slicing helpers — so consumers read ranges, never recompute them ────────

/** Lines `range` (1-based inclusive) of `text`, joined. Empty range → ''. */
export function sliceLines(text: string | readonly string[], range: LineRange): string {
  const lines = typeof text === 'string' ? text.split('\n') : text;
  if (range.end < range.start) return '';
  return lines.slice(range.start - 1, range.end).join('\n');
}

/**
 * A section's OWN body as authored: below the heading line, up to the next
 * section of any level (its first child's anchor block excluded).
 */
export function ownBodyOf(text: string | readonly string[], s: ParsedSection): string {
  return sliceLines(text, { start: s.headingLine + 1, end: s.ownEndLine });
}

/** Whole subtree body: below the heading line through the end of the subtree. */
export function subtreeBodyOf(text: string | readonly string[], s: ParsedSection): string {
  return sliceLines(text, { start: s.headingLine + 1, end: s.subtreeEndLine });
}

/**
 * 0-based index of the anchor line that OWNS `s` (the nearest anchor line above
 * its heading), or null for a heading without an anchor. Stacked orphans above
 * it are not its anchor.
 */
export function anchorLineIndexOf(lines: readonly string[], s: ParsedSection): number | null {
  if (s.anchor === null) return null;
  for (let j = s.headingLine - 2; j >= s.startLine - 1; j--) {
    if (anchorOfLine(lines[j] ?? '') !== null) return j;
  }
  return null;
}

/**
 * Anchor values carried by anchor LINES outside every excluded range, in order,
 * duplicates kept. An anchor-shaped line inside a code block is an example,
 * not an anchor (2.0.0).
 */
export function liveAnchorValues(text: string): string[] {
  const r = parseSections(text, { frontmatter: false });
  const lines = text.split('\n');
  const excluded = (i: number) =>
    r.excludedRanges.some((x) => i + 1 >= x.range.start && i + 1 <= x.range.end);
  const out: string[] = [];
  lines.forEach((l, i) => {
    const a = anchorOfLine(l);
    if (a !== null && !excluded(i)) out.push(a);
  });
  return out;
}

/**
 * Put `<!-- anchor: anchors[k] -->` directly above the heading of `sections[k]`
 * (sections from a parse of `body`, in document order). Bottom-up, so the
 * parser's heading lines stay valid for the ones above — the one splice both
 * injection paths (page indexer, artifact anchors) share.
 */
export function insertAnchorLines(
  body: string,
  sections: readonly ParsedSection[],
  anchors: readonly string[],
): string {
  const lines = body.split('\n');
  for (let k = sections.length - 1; k >= 0; k--) {
    lines.splice(sections[k]!.headingLine - 1, 0, `<!-- anchor: ${anchors[k]} -->`);
  }
  return lines.join('\n');
}

/** Headings of the ancestors, outermost first. */
export function headingPathOf(result: SectionParseResult, s: ParsedSection): string[] {
  const path: string[] = [];
  let p = s.parent;
  while (p !== null) {
    const parent = result.sections[p]!;
    path.unshift(parent.heading);
    p = parent.parent;
  }
  return path;
}
