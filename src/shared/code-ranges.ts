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

/**
 * Char ranges markdown treats as code (fenced blocks + inline code spans), so
 * callers can leave tags inside them untouched.
 */
export function computeCodeRanges(text: string): CodeRange[] {
  const { fenced, gaps } = scanFences(text);
  const ranges: CodeRange[] = [...fenced];
  for (const span of findInlineCodeSpans(text, gaps)) ranges.push([span.start, span.end]);
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

/** True when [start, end) overlaps any of the (sorted) code ranges. */
export function intersectsCode(start: number, end: number, ranges: CodeRange[]): boolean {
  for (const [rs, re] of ranges) {
    if (start < re && end > rs) return true;
    if (rs >= end) break;
  }
  return false;
}
