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
 * Scan fenced code blocks (``` / ~~~), returning the fenced ranges and the
 * gaps between them. An unclosed fence extends to end-of-string — matching how
 * react-markdown parses a mid-stream message (everything after an open fence is
 * code until it closes), so the streaming-transient case shows the raw tag.
 *
 * Tilde fences are handled; tildes never start inline code.
 */
export function scanFences(text: string): { fenced: CodeRange[]; gaps: CodeRange[] } {
  const fenced: CodeRange[] = [];
  const gaps: CodeRange[] = [];
  const fenceRe = /^( {0,3})(`{3,}|~{3,})/;
  const len = text.length;
  let i = 0;
  let segStart = 0;
  while (i < len) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? len : nl;
    const m = fenceRe.exec(text.slice(i, lineEnd));
    if (m) {
      const fenceChar = m[2]![0]!;
      const n = m[2]!.length;
      const openLineStart = i;
      if (openLineStart > segStart) gaps.push([segStart, openLineStart]);
      let j = nl === -1 ? len : nl + 1;
      let blockEnd = len; // unclosed fence → to EOF
      const closeRe = new RegExp(`^ {0,3}(\\${fenceChar}{${n},})[ \\t]*$`);
      while (j < len) {
        const jnl = text.indexOf('\n', j);
        const jEnd = jnl === -1 ? len : jnl;
        if (closeRe.test(text.slice(j, jEnd))) {
          blockEnd = jEnd;
          break;
        }
        j = jnl === -1 ? len : jnl + 1;
      }
      fenced.push([openLineStart, blockEnd]);
      const after = text.indexOf('\n', blockEnd);
      i = after === -1 ? len : after + 1;
      segStart = i;
      continue;
    }
    i = nl === -1 ? len : nl + 1;
  }
  if (segStart < len) gaps.push([segStart, len]);
  return { fenced, gaps };
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

/**
 * Char ranges that reference operations must treat as "not a live reference":
 * code (fenced + inline) PLUS unknown-JSX component regions (`.mdx` tags ∉
 * dispatch allowlist — M20 raw code node). The JSX scan skips matches already
 * inside code ranges. Returned sorted by start.
 *
 * `parseXmlTagsExcludingCode` filters against this so a registered ref nested
 * inside `<Callout>…</Callout>` is ignored — without it, slug rename would
 * byte-rewrite that ref and corrupt the JSX block (M19 `ykze87pl`). Editor
 * render (`computeCodeRanges`) is intentionally left untouched: the editor
 * handles unknown JSX via its own markdown-it rules, not via code ranges.
 */
export function computeExcludedRanges(text: string): CodeRange[] {
  const codeRanges = computeCodeRanges(text);
  const jsxRanges = findUnknownJsxRanges(text, codeRanges);
  if (jsxRanges.length === 0) return codeRanges;
  return [...codeRanges, ...jsxRanges].sort((a, b) => a[0] - b[0]);
}

/** True when [start, end) overlaps any of the (sorted) code ranges. */
export function intersectsCode(start: number, end: number, ranges: CodeRange[]): boolean {
  for (const [rs, re] of ranges) {
    if (start < re && end > rs) return true;
    if (rs >= end) break;
  }
  return false;
}
