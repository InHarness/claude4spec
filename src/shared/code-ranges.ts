/**
 * M51 — the scanner of ranges that are NOT content: fenced and inline code,
 * unknown JSX regions and multi-line HTML comments. A registered XML tag
 * inside such a range is a syntax example — not resolved, not backlinked, not
 * rewritten on a slug / anchor change, not checked, not indexed. Shared by the
 * tag parser (`xml-tags.ts`), the section parser and the chat chip pipeline.
 *
 * Pure string functions (no DOM, no Node-only APIs); compiled into both the
 * client and server builds via `src/shared`.
 *
 * Block boundaries come from the block tokenizer shared with the editor
 * (`markdown-blocks.ts`); positions inside a block are computed here, char by
 * char, because the byte-exact rewrite contract needs them (`sjjkc8bt`). A
 * 4-space indented block is a code block, as in the editor (2.1.65).
 */

import { findJsxSpanEnd, isAsciiPunct, isPassthroughTag, matchJsxTagOpen } from './jsx-passthrough.js';
import { scanBlockStructure } from './markdown-blocks.js';
import { findXmlTagCandidates, type XmlTag } from './xml-tags.js';

export type CodeRange = [start: number, end: number]; // half-open [start, end)

export interface InlineCodeSpan {
  start: number; // offset of the opening backtick run
  end: number; // offset just past the closing backtick run
  innerStart: number;
  innerEnd: number;
}

/**
 * 2.0.0 — one block of text the reader never treats as live markdown: a fenced
 * or (2.1.65) indented code block, or a multi-line HTML comment.
 * `startLine`/`endLine` are 1-based and inclusive; `start`/`end` are half-open
 * char offsets (`end` stops before the newline of the last line).
 * `closed: false` — nothing closes the block, so it runs to end of document.
 * `endsWithContainer: true` — nothing of its own closes the block either (no
 * closing fence, no `-->`), but the list item or block quote it opened in ends
 * it before the end of the document (`closed` stays true: the text after the
 * container is read live).
 */
export interface ExcludedBlock {
  kind: 'fence' | 'indented-code' | 'html-comment';
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  closed: boolean;
  endsWithContainer: boolean;
}

/**
 * Code blocks (fenced and indented) and multi-line HTML comments, in document
 * order, with the boundaries the shared block tokenizer gives them
 * (`markdown-blocks.ts`). A fence follows CommonMark: it may open after a list
 * or quote marker, its closing indent is measured from the container's
 * content, a shorter or different fence inside is content; a fence nothing
 * closes ends with the container it opened in, or with the document
 * (`closed: false` only for the latter).
 *
 * Multi-line HTML comment: a block opening with `<!--` whose first line carries
 * no `-->`; it runs through the first later line containing `-->`. A one-line
 * comment (an anchor line included) is NOT a block.
 */
export function scanExcludedBlocks(
  text: string,
  opts: { htmlComments?: boolean } = {},
): ExcludedBlock[] {
  const withComments = opts.htmlComments ?? true;
  const { blocks } = scanBlockStructure(text);
  return withComments ? blocks : blocks.filter((b) => b.kind !== 'html-comment');
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
 * gaps between them. A fence nothing closes ends with the container it opened
 * in (list item, block quote) or, at top level, with the end of the string —
 * matching how react-markdown parses a mid-stream message (everything after an
 * open top-level fence is code until it closes), so the streaming-transient
 * case shows the raw tag.
 *
 * 2.0.0 — CommonMark fences: the opening fence may follow a list / quote marker
 * and a backtick fence's info string may not contain a backtick. Tilde fences
 * are handled; tildes never start inline code.
 */
export function scanFences(text: string): { fenced: CodeRange[]; gaps: CodeRange[] } {
  const blocks = scanExcludedBlocks(text, { htmlComments: false }).filter((b) => b.kind === 'fence');
  return {
    fenced: blocks.map((b) => [b.start, b.end] as CodeRange),
    gaps: gapsBetween(text.length, blocks),
  };
}

/**
 * Code blocks of both kinds — fenced and (2.1.65) 4-space indented — returning
 * their ranges and the gaps between them. What a server-side rewrite or link
 * scan skips, so that it treats an indented block exactly as the tag parser
 * does (a `<section_ref>` and an `@path#anchor` link in it are both examples).
 */
export function scanCodeBlocks(text: string): { code: CodeRange[]; gaps: CodeRange[] } {
  const blocks = scanExcludedBlocks(text, { htmlComments: false });
  return {
    code: blocks.map((b) => [b.start, b.end] as CodeRange),
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
 * attribute value that contains a backtick, of every tag candidate
 * lying wholly inside one of `gaps`, blanked to spaces — same length, so offsets computed on the masked
 * string are valid on the original. Candidates crossing a fence are left alone.
 */
export function maskTagAttributeValues(text: string, gaps?: CodeRange[]): string {
  if (!text.includes('`')) return text;
  const regions = gaps ?? scanFences(text).gaps;
  let out = text;
  let changed = false;
  for (const tag of findXmlTagCandidates(text)) {
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

/** One excluded region with its kind — the section parser's `excludedRanges` source. */
export interface ExcludedRegion {
  kind: 'fence' | 'indented-code' | 'jsx' | 'html-comment';
  start: number;
  end: number;
}

export interface ExcludedScan {
  /** Regions (code blocks, multi-line HTML comments, block and inline JSX), sorted by start. */
  regions: ExcludedRegion[];
  /**
   * Blocks without a closing line of their own — those running to the end of
   * the document and (2.1.65, M19 rule 16) those ended only by the end of the
   * container they opened in. Both hide what lies under them up to that end.
   */
  unclosed: ExcludedBlock[];
  /** Every excluded char range incl. inline code spans, sorted — what tag filters test against. */
  ranges: CodeRange[];
}

const ATTR = `\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?`;
/**
 * The `<…>` constructs the editor's inline tokenizer consumes besides registered
 * tags and JSX regions (CommonMark raw HTML and autolinks): an HTML open or
 * closing tag (a stray JSX closing tag too), a one-line comment, a processing
 * instruction, a declaration, CDATA, a URI or an e-mail autolink.
 */
const INLINE_ANGLE_RE = new RegExp(
  [
    `<[A-Za-z][A-Za-z0-9-]*(?:${ATTR})*\\s*\\/?>`,
    `<\\/[A-Za-z][\\w.-]*\\s*>`,
    `<!---?>|<!--(?:[^-]|-[^-]|--[^>])*-->`,
    `<[?][\\s\\S]*?[?]>`,
    `<![A-Za-z][^>]*>`,
    `<!\\[CDATA\\[[\\s\\S]*?\\]\\]>`,
    `<[a-zA-Z][a-zA-Z0-9+.\\-]{1,31}:[^<>\\x00-\\x20]*>`,
    `<[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>`,
  ].join('|'),
  'y',
);

/** `text` with the backtick-carrying attribute values of `candidates` blanked (same length). */
function maskCandidates(text: string, candidates: readonly XmlTag[]): string {
  let out = text;
  for (const tag of candidates) {
    if (!tag.raw.includes('`')) continue;
    ATTR_VALUE_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR_VALUE_REGEX.exec(tag.raw)) !== null) {
      const value = m[1]!;
      if (!value.includes('`')) continue;
      const vStart = tag.start + m.index + m[0].length - 1 - value.length;
      out = out.slice(0, vStart) + ' '.repeat(value.length) + out.slice(vStart + value.length);
    }
  }
  return out;
}

/** Offset of the next backtick run of exactly `len` in `[from, end)`, or -1. */
function closingRun(text: string, from: number, end: number, len: number): number {
  let j = from;
  while (j < end) {
    if (text.charCodeAt(j) !== 0x60) {
      j++;
      continue;
    }
    let k = j;
    while (k < end && text.charCodeAt(k) === 0x60) k++;
    if (k - j === len) return j;
    j = k;
  }
  return -1;
}

/**
 * Step 3 of the scan inside ONE inline block `[start, end)` of the masked text:
 * a walk by position in which the construct that starts earlier wins
 * (`m6t9i6z9`). A run of N backticks opens inline code closed by the nearest
 * later run of exactly N in the same block, else it is literal; a backslash
 * before ASCII punctuation escapes it. A registered tag candidate, an HTML
 * construct or an autolink is skipped whole, so a backtick inside it opens
 * nothing. A component-shaped tag outside the registry opens an inline JSX
 * region: self-closing, or paired with a close in the same block (nesting
 * counted by name); an unpaired opening is plain text and defines no range.
 */
function scanInlineBlock(
  masked: string,
  start: number,
  end: number,
  candidateEnd: ReadonlyMap<number, number>,
  code: CodeRange[],
  jsx: CodeRange[],
): void {
  let i = start;
  while (i < end) {
    const ch = masked.charCodeAt(i);
    if (ch === 0x5c /* \ */) {
      i += i + 1 < end && isAsciiPunct(masked.charCodeAt(i + 1)) ? 2 : 1;
      continue;
    }
    if (ch === 0x60 /* ` */) {
      let runEnd = i;
      while (runEnd < end && masked.charCodeAt(runEnd) === 0x60) runEnd++;
      const len = runEnd - i;
      const closer = closingRun(masked, runEnd, end, len);
      if (closer === -1) {
        i = runEnd;
        continue;
      }
      code.push([i, closer + len]);
      i = closer + len;
      continue;
    }
    if (ch === 0x3c /* < */) {
      const cand = candidateEnd.get(i);
      if (cand !== undefined && cand <= end) {
        i = cand;
        continue;
      }
      const open = matchJsxTagOpen(masked, i);
      if (open && open.openEnd <= end && isPassthroughTag(open.name)) {
        if (open.selfClosing) {
          jsx.push([i, open.openEnd]);
          i = open.openEnd;
          continue;
        }
        const close = findJsxSpanEnd(masked, i, open.name, [], end);
        if (close !== -1) {
          jsx.push([i, close]);
          i = close;
          continue;
        }
        i = open.openEnd;
        continue;
      }
      INLINE_ANGLE_RE.lastIndex = 0;
      const m = INLINE_ANGLE_RE.exec(masked.slice(i, end));
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
}

/**
 * M51 — THE non-content scanner. One pass, one resolution order, one result
 * for every server consumer (tag parser and section parser alike), in the
 * order `sjjkc8bt` fixes:
 *  1. block structure from the tokenizer shared with the editor: code blocks
 *     (fenced and indented), multi-line HTML comments, block JSX regions and
 *     the boundaries of inline blocks (`markdown-blocks.ts`). Other HTML blocks
 *     are no range. The extension is not an input (2.1.7);
 *  2. registered tag candidates (`findXmlTagCandidates`);
 *  3. inside every inline block, over the text with the candidates' attribute
 *     values masked, a walk by position: inline code, inline JSX regions and
 *     the other `<…>` constructs — the earlier one wins
 *     ({@link scanInlineBlock});
 *  4. callers drop the candidates the resulting ranges intersect.
 * No range ever crosses an inline block, and no JSX region runs to the end of
 * a document or container: an unpaired opening defines none.
 */
export function scanExcluded(text: string): ExcludedScan {
  const { blocks, jsxBlocks, inlineBlocks } = scanBlockStructure(text);
  const regions: ExcludedRegion[] = blocks.map((b) => ({ kind: b.kind, start: b.start, end: b.end }));
  for (const [start, end] of jsxBlocks) regions.push({ kind: 'jsx', start, end });

  const candidates = findXmlTagCandidates(text);
  const candidateEnd = new Map<number, number>();
  for (const c of candidates) candidateEnd.set(c.start, c.end);
  const masked = text.includes('`') ? maskCandidates(text, candidates) : text;
  const code: CodeRange[] = [];
  const jsx: CodeRange[] = [];
  for (const [start, end] of inlineBlocks) scanInlineBlock(masked, start, end, candidateEnd, code, jsx);
  for (const [start, end] of jsx) regions.push({ kind: 'jsx', start, end });

  regions.sort((a, b) => a.start - b.start);
  const ranges: CodeRange[] = regions.map((r) => [r.start, r.end] as CodeRange);
  for (const span of code) ranges.push(span);
  ranges.sort((a, b) => a[0] - b[0]);
  return { regions, unclosed: blocks.filter((b) => !b.closed || b.endsWithContainer), ranges };
}

/** True when [start, end) overlaps any of the (sorted) code ranges. */
export function intersectsCode(start: number, end: number, ranges: CodeRange[]): boolean {
  for (const [rs, re] of ranges) {
    if (start < re && end > rs) return true;
    if (rs >= end) break;
  }
  return false;
}
