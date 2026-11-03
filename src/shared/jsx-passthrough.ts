/**
 * Single source of truth for the unknown-JSX passthrough mechanism (component
 * tags outside the M51 registry, in every markdown file). M51 delivers the
 * block rule of a JSX region ({@link jsxBlockRule}) and the nesting count by
 * name ({@link findJsxBlockEnd}) as tokenizer configuration shared by the
 * server scanner (`markdown-blocks.ts` → `code-ranges.ts`) and the editor
 * (M20 — `RawJsxNode`), so parity of the two pipelines follows from
 * construction: one source of the name set, of the block rule and of the
 * nesting count (`sjjkc8bt`).
 *
 * Leaf-ish: imports only the registry leaf; the `CodeRange` import is
 * type-only (erased at compile time) so `code-ranges.ts` can depend on this
 * module without an import cycle.
 */
import { isRegisteredXmlTag } from './xml-markup/registry.js';
import type { CodeRange } from './code-ranges.js';

/**
 * JSX component shape: name starts with an uppercase letter (`<Callout/>`) or
 * is a member expression (`<ui.Card/>`). Lowercase host/HTML tags (`<br>`,
 * `<strong>`, `<img>`, `<div>`) are NOT components — they stay in the
 * tiptap-markdown pipeline (→ hardBreak / bold / image) and must not be
 * swallowed into the raw node.
 */
export function isJsxComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes('.');
}

/** True when a tag should be routed to the raw JSX node: component-shaped AND not a registered tag. */
export function isPassthroughTag(name: string): boolean {
  return isJsxComponentName(name) && !isRegisteredXmlTag(name);
}

export interface JsxTagOpen {
  name: string;
  selfClosing: boolean;
  /** Absolute offset just past the `>` of the opening tag. */
  openEnd: number;
}

const TAG_NAME = '[A-Za-z][\\w.-]*';
const OPEN_AT_START_RE = new RegExp(`^<(${TAG_NAME})((?:\\s[^>]*?)?)(\\/?)>`);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a tag-open (`<Name …>` or `<Name …/>`) anchored exactly at `pos`, else null. */
export function matchJsxTagOpen(text: string, pos: number): JsxTagOpen | null {
  if (text.charCodeAt(pos) !== 0x3c /* < */) return null;
  const m = OPEN_AT_START_RE.exec(text.slice(pos));
  if (!m) return null;
  return {
    name: m[1]!,
    selfClosing: m[3] === '/',
    openEnd: pos + m[0].length,
  };
}

/**
 * Given an opening `<name …>` at `openStart`, return the absolute offset just
 * past the matching `</name>`, closing nested same-name pairs via
 * depth-counting. Returns -1 if unbalanced (no matching close) or if the tag at
 * `openStart` is not a non-self-closing `<name>`. `limit` bounds the search —
 * an inline region closes only inside its own inline block (M51 `5wf420mr`).
 */
export function findJsxSpanEnd(
  text: string,
  openStart: number,
  name: string,
  skip: ReadonlyArray<CodeRange> = [],
  limit: number = text.length,
): number {
  const open = matchJsxTagOpen(text, openStart);
  if (!open || open.name !== name || open.selfClosing) return -1;
  const openRe = new RegExp(`^<${escapeRegExp(name)}((?:\\s[^>]*?)?)(\\/?)>`);
  const closeRe = new RegExp(`^<\\/${escapeRegExp(name)}\\s*>`);
  if (open.openEnd > limit) return -1;
  let depth = 1;
  let i = open.openEnd;
  while (i < limit) {
    // A same-name open/close inside a fence or comment is an example, not nesting.
    const inSkip = skip.find(([rs, re]) => i >= rs && i < re);
    if (inSkip) {
      i = inSkip[1];
      continue;
    }
    if (text.charCodeAt(i) === 0x3c /* < */) {
      const tail = text.slice(i);
      const c = closeRe.exec(tail);
      if (c && i + c[0].length <= limit) {
        depth--;
        i += c[0].length;
        if (depth === 0) return i;
        continue;
      }
      const o = openRe.exec(tail);
      if (o) {
        if (o[2] !== '/') depth++; // non-self-closing open of same name nests
        i += o[0].length;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/** ASCII punctuation — the characters a backslash escapes in CommonMark. */
export function isAsciiPunct(ch: number): boolean {
  return (
    (ch >= 0x21 && ch <= 0x2f) ||
    (ch >= 0x3a && ch <= 0x40) ||
    (ch >= 0x5b && ch <= 0x60) ||
    (ch >= 0x7b && ch <= 0x7e)
  );
}

/**
 * Inline code spans of ONE line `[start, end)`: a run of N backticks opens, the
 * nearest later run of exactly N closes; a run without a partner is literal; a
 * backslash-escaped backtick outside code opens nothing. Used by the block
 * nesting counter, which skips tags quoted in inline code of the same line.
 */
export function lineCodeSpans(text: string, start: number, end: number): CodeRange[] {
  const spans: CodeRange[] = [];
  let i = start;
  while (i < end) {
    const ch = text.charCodeAt(i);
    if (ch === 0x5c /* \ */ && i + 1 < end && isAsciiPunct(text.charCodeAt(i + 1))) {
      i += 2;
      continue;
    }
    if (ch !== 0x60 /* ` */) {
      i++;
      continue;
    }
    let runEnd = i;
    while (runEnd < end && text.charCodeAt(runEnd) === 0x60) runEnd++;
    const len = runEnd - i;
    let j = runEnd;
    let closer = -1;
    while (j < end) {
      if (text.charCodeAt(j) !== 0x60) {
        j++;
        continue;
      }
      let k = j;
      while (k < end && text.charCodeAt(k) === 0x60) k++;
      if (k - j === len) {
        closer = j;
        break;
      }
      j = k;
    }
    if (closer === -1) {
      i = runEnd;
      continue;
    }
    spans.push([i, closer + len]);
    i = closer + len;
  }
  return spans;
}

/** Columns of the leading whitespace of `[from, to)` — a tab advances to the next multiple of 4. */
function leadingColumns(text: string, from: number, to: number): number {
  let col = 0;
  for (let i = from; i < to; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x20) col++;
    else if (ch === 0x09) col += 4 - (col % 4);
    else break;
  }
  return col;
}

export interface JsxBlockEnd {
  /** Absolute offset just past the matching `</name>`. */
  end: number;
  /** Index (into `lines`) of the line the closing tag stands on. */
  line: number;
}

/**
 * M51 — THE nesting counter of a block JSX region (`61f2qnb2`), shared by the
 * server scanner and the editor. Counts same-name opens and closes from the
 * opening tag at `openStart` over the given container lines only — each line
 * is `[from, to)` in `text`, the first one starting at the opening tag. A tag
 * quoted in inline code of its line neither opens nor closes a level:
 * `` `</Callout>` `` does not end the region, `` `<Callout>` `` does not nest;
 * the lines of a fence opened inside the region are code, not nesting. A
 * fence line (opening or closing) is indented at most three columns past the
 * container's content, as in CommonMark — `baseIndent` is that content's
 * column measured from each line's `from` (`state.blkIndent` in a block rule);
 * a line indented four or more is content, not a fence.
 * Returns null when nothing in the container closes the pair — an unpaired
 * opening is plain text and defines no range.
 */
export function findJsxBlockEnd(
  text: string,
  openStart: number,
  name: string,
  lines: Iterable<readonly [number, number]>,
  baseIndent: number = 0,
): JsxBlockEnd | null {
  const open = matchJsxTagOpen(text, openStart);
  if (!open || open.name !== name || open.selfClosing) return null;
  const openRe = new RegExp(`^<${escapeRegExp(name)}((?:\\s[^>]*?)?)(\\/?)>`);
  const closeRe = new RegExp(`^<\\/${escapeRegExp(name)}\\s*>`);
  let depth = 1;
  /**
   * A fence open inside the region: its lines are code, never nesting.
   * ASSUMPTION:dev-0002 — M51 `61f2qnb2` names only inline code of the same
   * line; a closing tag inside a fence within the region is skipped too.
   */
  let fence: { ch: string; len: number } | null = null;
  // Lines are consumed in order and no further than the closing tag, so a
  // caller may hand a lazy sequence and pay only for the region's lines.
  let li = -1;
  for (const [from, to] of lines) {
    li++;
    if (to <= open.openEnd) continue;
    if (from >= open.openEnd) {
      // CommonMark: a fence line is indented at most 3 columns (from the container's content).
      const fenceIndent = leadingColumns(text, from, to) - baseIndent <= 3;
      const body = text.slice(from, to).replace(/^[ \t]+/, '').replace(/\r$/, '');
      if (fence) {
        const c = fenceIndent ? /^(`+|~+)[ \t]*$/.exec(body) : null;
        if (c && c[1]![0] === fence.ch && c[1]!.length >= fence.len) fence = null;
        continue;
      }
      const f = fenceIndent ? /^(`{3,}|~{3,})(.*)$/.exec(body) : null;
      if (f && !(f[1]![0] === '`' && f[2]!.includes('`'))) {
        fence = { ch: f[1]![0]!, len: f[1]!.length };
        continue;
      }
    }
    const scanFrom = Math.max(from, open.openEnd);
    const code = lineCodeSpans(text, scanFrom, to);
    let ci = 0;
    let i = scanFrom;
    while (i < to) {
      while (ci < code.length && code[ci]![1] <= i) ci++;
      const span = code[ci];
      if (span && i >= span[0]) {
        i = span[1];
        continue;
      }
      if (text.charCodeAt(i) === 0x3c /* < */) {
        const tail = text.slice(i, to);
        const c = closeRe.exec(tail);
        if (c) {
          depth--;
          i += c[0].length;
          if (depth === 0) return { end: i, line: li };
          continue;
        }
        const o = openRe.exec(tail);
        if (o) {
          if (o[2] !== '/') depth++;
          i += o[0].length;
          continue;
        }
      }
      i++;
    }
  }
  return null;
}

/**
 * Offsets of every `</name` in `src`, ascending — the only places a block
 * region of `name` can close. Cached for the last source text seen, so one
 * tokenizer pass computes them once per name, not once per opening tag.
 */
let closeCache: { src: string; byName: Map<string, number[]> } | null = null;
function closeCandidates(src: string, name: string): number[] {
  if (!closeCache || closeCache.src !== src) closeCache = { src, byName: new Map() };
  let list = closeCache.byName.get(name);
  if (!list) {
    list = [];
    const needle = `</${name}`;
    for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + needle.length)) list.push(i);
    closeCache.byName.set(name, list);
  }
  return list;
}

/** What a block-rule caller does with a matched region. */
export interface JsxBlockRuleOptions {
  /** Does the tag named `name` at `pos` open a region? Server: {@link isPassthroughTag}. */
  accepts?: (name: string, src: string, pos: number) => boolean;
  /** Content of the emitted `html_block` token (the editor's raw node HTML); `''` by default. */
  emit?: (raw: string) => string;
}

/** Name under which the block rule sits in the markdown-it block ruler (before `html_block`). */
export const JSX_BLOCK_RULE_NAME = 'raw_jsx_block';

/** `token.meta` of a block JSX region: its exact char range in the source. */
export interface JsxBlockMeta {
  jsxRegion: CodeRange;
}

/**
 * M51 — THE block rule of an unknown JSX region (`61f2qnb2`), one config for
 * both tokenizers: the server scanner's and the editor's (`sjjkc8bt`). A tag
 * opens a block region when all hold at once:
 *  - the line starts with the tag after at most three spaces of indent,
 *    measured from the container's content (list item or block quote) — four
 *    or more is an indented code block;
 *  - the line does not continue a paragraph (the rule is in no `alt` chain, so
 *    it never interrupts one);
 *  - a self-closing tag stands alone on its line, or the pair is closed in the
 *    SAME container ({@link findJsxBlockEnd}) with only whitespace after the
 *    closing tag.
 * The region may span many lines, blank ones too. A pair split by a container
 * boundary is two unpaired tags: the rule declines and the tags stay text.
 *
 * Emits one `html_block` token whose `meta` carries the exact region
 * ({@link JsxBlockMeta}); `map` spans its lines.
 */
export function jsxBlockRule(options: JsxBlockRuleOptions = {}) {
  const accepts = options.accepts ?? ((name: string) => isPassthroughTag(name));
  const emit = options.emit ?? (() => '');
  // markdown-it's StateBlock — typed loosely, as everywhere in the editor rules.
  return (state: any, startLine: number, endLine: number, silent: boolean): boolean => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const src: string = state.src;
    const pos: number = state.bMarks[startLine] + state.tShift[startLine];
    const max: number = state.eMarks[startLine];
    if (src.charCodeAt(pos) !== 0x3c /* < */) return false;
    const open = matchJsxTagOpen(src, pos);
    if (!open || !accepts(open.name, src, pos)) return false;

    // A pair closes only at a `</name` in the text: with none after the
    // opening tag, the opening is unpaired — decline without walking the lines.
    // `lastClose` bounds the walk below: no line past it can hold the close.
    let lastClose = -1;
    if (!open.selfClosing) {
      const candidates = closeCandidates(src, open.name);
      lastClose = candidates.length > 0 ? candidates[candidates.length - 1]! : -1;
      if (lastClose < open.openEnd) return false;
    }

    // The container's lines, from the opening line on, produced lazily: a
    // non-blank line indented below the container's content ends it (list
    // item); a block quote already bounds `endLine`. Each rule call reads only
    // as far as the region it finds (or the last `</name`), never to the end
    // of the document — so a page of many regions or unpaired openings is not
    // quadratic in its lines.
    function* containerLines(stopAfter: number): Generator<[number, number]> {
      for (let l = startLine; l < endLine; l++) {
        const blank = state.bMarks[l] + state.tShift[l] >= state.eMarks[l];
        if (l > startLine && !blank && state.sCount[l] < state.blkIndent) return;
        if (l > startLine && state.bMarks[l] > stopAfter) return;
        yield [l === startLine ? pos : state.bMarks[l], state.eMarks[l]];
      }
    }

    let end: number;
    let closeLine: number;
    if (open.selfClosing) {
      // The line (of the container) the self-closing tag ends on.
      let k = -1;
      let idx = 0;
      for (const [, to] of containerLines(Infinity)) {
        if (open.openEnd <= to) {
          k = idx;
          break;
        }
        idx++;
      }
      if (k === -1) return false;
      end = open.openEnd;
      closeLine = startLine + k;
    } else {
      const close = findJsxBlockEnd(src, pos, open.name, containerLines(lastClose), state.blkIndent);
      // A close lies past the opening tag, so the tag ends inside the container's lines.
      if (!close) return false;
      end = close.end;
      closeLine = startLine + close.line;
    }
    if (src.slice(end, state.eMarks[closeLine]).trim() !== '') return false;
    if (closeLine === startLine && end > max) return false;
    if (silent) return true;

    const token = state.push('html_block', '', 0);
    token.content = emit(src.slice(pos, end));
    token.map = [startLine, closeLine + 1];
    token.meta = { jsxRegion: [pos, end] } satisfies JsxBlockMeta;
    state.line = closeLine + 1;
    return true;
  };
}
