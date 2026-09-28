/**
 * Code-context scanning shared by the chat chip pipeline and the server-side
 * reference parser. Both need to know which character ranges of a markdown
 * string the reader treats as code (fenced blocks + inline code spans), so that
 * XML reference tags appearing inside code — i.e. deliberate syntax examples —
 * are NOT treated as real references.
 *
 * Pure string functions (no DOM, no Node-only APIs); compiled into both the
 * client and server builds via `src/shared`.
 *
 * Known gap: 4-space indented code blocks are NOT detected (rare in agent
 * output and on spec pages, which use fences/inline). markdown-it does detect
 * them, so the editor render path diverges here; closeable later if needed.
 */

import { findUnknownJsxRanges } from './jsx-passthrough.js';
import { parseXmlTags } from './xml-tags.js';

export type CodeRange = [start: number, end: number]; // half-open [start, end)

export interface InlineCodeSpan {
  start: number; // offset of the opening backtick run
  end: number; // offset just past the closing backtick run
  innerStart: number;
  innerEnd: number;
}

/**
 * 2.0.0 — one block of text the reader never treats as live markdown: a fenced
 * code block, or a multi-line HTML comment. `startLine`/`endLine` are 1-based
 * and inclusive; `start`/`end` are half-open char offsets (`end` stops before
 * the newline of the last line). `closed: false` — nothing closes the block, so
 * it runs to end of document.
 */
export interface ExcludedBlock {
  kind: 'fence' | 'html-comment';
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  closed: boolean;
}

interface LineSplit {
  /** Offset of each line's first char. */
  starts: number[];
  lines: string[];
}

function splitLines(text: string): LineSplit {
  const lines = text.split('\n');
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  return { starts, lines };
}

const QUOTE_RE = /^ {0,3}> ?/;
const LIST_MARKER_RE = /^( {0,3})([-*+]|\d{1,9}[.)])( {1,4}|$)/;

/** Strip up to `max` block-quote markers (`>`); returns the count and the rest. */
function stripQuotes(line: string, max = Infinity): { quotes: number; body: string } {
  let body = line;
  let quotes = 0;
  while (quotes < max) {
    const m = QUOTE_RE.exec(body);
    if (!m) break;
    body = body.slice(m[0].length);
    quotes++;
  }
  return { quotes, body };
}

function leadingSpaces(s: string): number {
  let i = 0;
  while (i < s.length && s[i] === ' ') i++;
  return i;
}

const FENCE_OPEN_RE = /^(`{3,}|~{3,})(.*)$/;

interface FenceOpen {
  char: string;
  len: number;
  quotes: number;
  /** Column (after quote markers) where the owning list item's content starts; 0 outside lists. */
  base: number;
}

/**
 * Does `line` open a fence? CommonMark rules: ≥3 backticks or tildes, at most 3
 * spaces of indent relative to the enclosing container, and a backtick fence's
 * info string may not contain a backtick (that line is inline code, not a
 * fence). The opening fence may follow a container marker (`- `, `1. `, `> `)
 * on the same line, or sit on a continuation line of a list item — then its
 * indent is measured from that item's content column (`itemIndents`).
 */
function matchFenceOpen(line: string, itemIndents: readonly number[]): FenceOpen | null {
  const { quotes, body } = stripQuotes(line);
  let rest = body;
  let base = 0;
  // Same-line list markers (possibly nested: `- 1. ```).
  for (;;) {
    const m = LIST_MARKER_RE.exec(rest);
    if (!m || m[3] === '') break;
    const w = m[0].length;
    base += w;
    rest = rest.slice(w);
  }
  let indent = leadingSpaces(rest);
  if (base === 0) {
    // Continuation line: measure from the innermost list item that still owns it.
    let owner = 0;
    for (const w of itemIndents) if (w <= indent && w > owner) owner = w;
    base = owner;
    indent -= owner;
  }
  if (indent > 3) return null;
  const m = FENCE_OPEN_RE.exec(rest.slice(leadingSpaces(rest)));
  if (!m) return null;
  const run = m[1]!;
  if (run[0] === '`' && m[2]!.includes('`')) return null;
  return { char: run[0]!, len: run.length, quotes, base };
}

type FenceStep = 'content' | 'close' | 'ends-before';

/** Classify a line inside an open fence: still content, the closing fence, or a container end. */
function fenceStep(line: string, open: FenceOpen): FenceStep {
  const { quotes, body } = stripQuotes(line, open.quotes);
  if (quotes < open.quotes) {
    // Leaving the block quote ends the fence (no lazy continuation for code).
    return 'ends-before';
  }
  const blank = body.trim() === '';
  const indent = leadingSpaces(body);
  if (open.base > 0 && !blank && indent < open.base) return 'ends-before';
  const rel = indent - open.base;
  if (rel < 0 || rel > 3) return 'content';
  const closeRe = new RegExp(`^\\${open.char}{${open.len},}[ \\t]*$`);
  return closeRe.test(body.slice(indent)) ? 'close' : 'content';
}

const COMMENT_OPEN_RE = /^ {0,3}<!--/;

/**
 * Fenced code blocks and multi-line HTML comments, in document order. A block
 * nothing closes runs to end of document (`closed: false`).
 *
 * Multi-line HTML comment: a line indented at most 3 spaces that starts with
 * `<!--` and carries no `-->`; it runs through the first later line containing
 * `-->`. A one-line comment (an anchor line included) is NOT a block.
 */
export function scanExcludedBlocks(
  text: string,
  opts: { htmlComments?: boolean } = {},
): ExcludedBlock[] {
  const withComments = opts.htmlComments ?? true;
  const { starts, lines } = splitLines(text);
  const lineEnd = (i: number) => starts[i]! + lines[i]!.length;
  const blocks: ExcludedBlock[] = [];
  /** Content columns of the list items open around the current line. */
  let itemIndents: number[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = matchFenceOpen(line, itemIndents);
    if (fence) {
      let j = i + 1;
      let endIdx = lines.length - 1;
      let closed = false;
      while (j < lines.length) {
        const step = fenceStep(lines[j]!, fence);
        if (step === 'close') {
          endIdx = j;
          closed = true;
          break;
        }
        if (step === 'ends-before') {
          endIdx = j - 1;
          closed = true;
          break;
        }
        j++;
      }
      blocks.push({
        kind: 'fence',
        start: starts[i]!,
        end: lineEnd(endIdx),
        startLine: i + 1,
        endLine: endIdx + 1,
        closed,
      });
      i = endIdx + 1;
      continue;
    }
    if (withComments && COMMENT_OPEN_RE.test(line) && !line.includes('-->')) {
      let j = i + 1;
      while (j < lines.length && !lines[j]!.includes('-->')) j++;
      const closed = j < lines.length;
      const endIdx = closed ? j : lines.length - 1;
      blocks.push({
        kind: 'html-comment',
        start: starts[i]!,
        end: lineEnd(endIdx),
        startLine: i + 1,
        endLine: endIdx + 1,
        closed,
      });
      i = endIdx + 1;
      continue;
    }
    // Track list-item content columns for continuation-line fences.
    const { body } = stripQuotes(line);
    if (body.trim() !== '') {
      const indent = leadingSpaces(body);
      itemIndents = itemIndents.filter((w) => w <= indent);
      const m = LIST_MARKER_RE.exec(body.slice(0));
      if (m && m[3] !== '') itemIndents.push(m[0].length);
    }
    i++;
  }
  return blocks;
}

function gapsBetween(len: number, blocks: ReadonlyArray<{ start: number; end: number }>): CodeRange[] {
  const gaps: CodeRange[] = [];
  let cursor = 0;
  for (const b of blocks) {
    if (b.start > cursor) gaps.push([cursor, b.start]);
    cursor = Math.max(cursor, b.end);
    // The newline ending a block belongs to neither the block nor the gap
    // before it — skip it so the next gap starts on the following line.
    if (cursor < len && cursor === b.end) cursor = Math.min(len, cursor + 1);
  }
  if (cursor < len) gaps.push([cursor, len]);
  return gaps;
}

/**
 * Scan fenced code blocks (``` / ~~~), returning the fenced ranges and the
 * gaps between them. An unclosed fence extends to end-of-string — matching how
 * react-markdown parses a mid-stream message (everything after an open fence is
 * code until it closes), so the streaming-transient case shows the raw tag.
 *
 * 2.0.0 — CommonMark fences: the opening fence may follow a list / quote marker
 * and a backtick fence's info string may not contain a backtick. Tilde fences
 * are handled; tildes never start inline code.
 */
export function scanFences(text: string): { fenced: CodeRange[]; gaps: CodeRange[] } {
  const blocks = scanExcludedBlocks(text, { htmlComments: false });
  return {
    fenced: blocks.map((b) => [b.start, b.end] as CodeRange),
    gaps: gapsBetween(text.length, blocks),
  };
}

/**
 * Inline code spans within the given (non-fenced) gaps. A run of N backticks
 * opens; the next run of exactly N backticks closes. Unmatched runs are literal
 * text, not code.
 */
export function findInlineCodeSpans(text: string, gaps: CodeRange[]): InlineCodeSpan[] {
  const spans: InlineCodeSpan[] = [];
  for (const [gStart, gEnd] of gaps) {
    const seg = text.slice(gStart, gEnd);
    const tickRe = /`+/g;
    const runs: Array<{ start: number; len: number }> = [];
    let mm: RegExpExecArray | null;
    while ((mm = tickRe.exec(seg)) !== null) runs.push({ start: mm.index, len: mm[0].length });
    let k = 0;
    while (k < runs.length) {
      const open = runs[k]!;
      let closed = false;
      for (let q = k + 1; q < runs.length; q++) {
        if (runs[q]!.len === open.len) {
          spans.push({
            start: gStart + open.start,
            innerStart: gStart + open.start + open.len,
            innerEnd: gStart + runs[q]!.start,
            end: gStart + runs[q]!.start + runs[q]!.len,
          });
          k = q + 1;
          closed = true;
          break;
        }
      }
      if (!closed) k++;
    }
  }
  return spans;
}

const ATTR_VALUE_REGEX = /\w+="([^"]*)"/g;

/**
 * Masking gate shared by the server reference parser and the editor's
 * markdown-it pipeline (0.2.92): a backtick inside an attribute VALUE of a tag
 * candidate is not an inline-code delimiter. Returns `text` with every
 * attribute value that contains a backtick, of every `parseXmlTags` candidate
 * lying wholly inside one of `gaps`, blanked to spaces — same length, so offsets computed on the masked
 * string are valid on the original. Candidates crossing a fence are left alone.
 */
export function maskTagAttributeValues(text: string, gaps?: CodeRange[]): string {
  if (!text.includes('`')) return text;
  const regions = gaps ?? scanFences(text).gaps;
  let out = text;
  let changed = false;
  for (const tag of parseXmlTags(text)) {
    if (!tag.raw.includes('`')) continue;
    if (!regions.some(([gs, ge]) => tag.start >= gs && tag.end <= ge)) continue;
    ATTR_VALUE_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR_VALUE_REGEX.exec(tag.raw)) !== null) {
      const value = m[1]!;
      if (!value.includes('`')) continue;
      const vStart = tag.start + m.index + m[0].length - 1 - value.length;
      out = out.slice(0, vStart) + ' '.repeat(value.length) + out.slice(vStart + value.length);
      changed = true;
    }
  }
  return changed ? out : text;
}

/**
 * Char ranges markdown treats as code (fenced blocks + inline code spans), so
 * callers can leave tags inside them untouched.
 *
 * Order (0.2.92): (1) fences, (2) `parseXmlTags` candidates in the gaps,
 * (3) backtick-pair scan over the text with the candidates' attribute values
 * masked, (4) callers filter candidates against the resulting ranges.
 */
export function computeCodeRanges(text: string): CodeRange[] {
  const { fenced, gaps } = scanFences(text);
  const ranges: CodeRange[] = [...fenced];
  const masked = maskTagAttributeValues(text, gaps);
  for (const span of findInlineCodeSpans(masked, gaps)) ranges.push([span.start, span.end]);
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

/** One excluded region with its kind — the section parser's `excludedRanges` source. */
export interface ExcludedRegion {
  kind: 'fence' | 'jsx' | 'html-comment';
  start: number;
  end: number;
}

export interface ExcludedScan {
  /** Block-level regions (fences, multi-line HTML comments, unknown JSX), sorted by start. */
  regions: ExcludedRegion[];
  /** Blocks nothing closes — they run to end of document. */
  unclosed: ExcludedBlock[];
  /** Every excluded char range incl. inline code spans, sorted — what tag filters test against. */
  ranges: CodeRange[];
}

/**
 * 2.0.0 — THE excluded-range scanner. One pass, one resolution order:
 *  1. fenced code blocks and multi-line HTML comments (`scanExcludedBlocks`);
 *  2. `parseXmlTags` candidates in the gaps between them;
 *  3. backtick-pair scan over the gaps with the candidates' attribute values
 *     masked (a backtick in `caption="…"` is not a code delimiter);
 *  4. unknown-JSX component regions outside all of the above (`jsx: false`
 *     skips them — the section parser only applies them to `.mdx`).
 * Callers filter tag candidates against `ranges`.
 */
export function scanExcluded(text: string, opts: { jsx?: boolean } = {}): ExcludedScan {
  const blocks = scanExcludedBlocks(text);
  const gaps = gapsBetween(text.length, blocks);
  const ranges: CodeRange[] = blocks.map((b) => [b.start, b.end] as CodeRange);
  const masked = maskTagAttributeValues(text, gaps);
  for (const span of findInlineCodeSpans(masked, gaps)) ranges.push([span.start, span.end]);
  ranges.sort((a, b) => a[0] - b[0]);
  const regions: ExcludedRegion[] = blocks.map((b) => ({ kind: b.kind, start: b.start, end: b.end }));
  if (opts.jsx ?? true) {
    const jsx = findUnknownJsxRanges(text, ranges);
    for (const [start, end] of jsx) {
      ranges.push([start, end]);
      regions.push({ kind: 'jsx', start, end });
    }
    if (jsx.length > 0) {
      ranges.sort((a, b) => a[0] - b[0]);
      regions.sort((a, b) => a.start - b.start);
    }
  }
  return { regions, unclosed: blocks.filter((b) => !b.closed), ranges };
}

/**
 * Char ranges that reference operations must treat as "not a live reference":
 * code (fenced + inline), multi-line HTML comments (2.0.0 — a commented-out tag
 * is not live) PLUS unknown-JSX component regions (tags ∉ dispatch allowlist —
 * M20 raw code node). Returned sorted by start.
 *
 * `parseXmlTagsExcludingCode` filters against this so a registered ref nested
 * inside `<Callout>…</Callout>` is ignored — without it, slug rename would
 * byte-rewrite that ref and corrupt the JSX block (M19 `ykze87pl`). Editor
 * render (`computeCodeRanges`) is intentionally left untouched: the editor
 * handles unknown JSX via its own markdown-it rules, not via code ranges.
 */
export function computeExcludedRanges(text: string): CodeRange[] {
  return scanExcluded(text).ranges;
}

/** True when [start, end) overlaps any of the (sorted) code ranges. */
export function intersectsCode(start: number, end: number, ranges: CodeRange[]): boolean {
  for (const [rs, re] of ranges) {
    if (start < re && end > rs) return true;
    if (rs >= end) break;
  }
  return false;
}
