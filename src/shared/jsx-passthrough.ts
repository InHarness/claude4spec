/**
 * Single source of truth for the unknown-JSX passthrough mechanism (`.mdx`
 * component tags outside the M51 registry). Reused by BOTH the editor
 * markdown-it rules (M20 — `RawJsxNode`) and the server-side non-content scanner
 * (M51 — `code-ranges.ts`), so both treat the exact same regions as "raw JSX,
 * not content": one source of the name set and of the nesting count.
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
 * `openStart` is not a non-self-closing `<name>`.
 */
export function findJsxSpanEnd(
  text: string,
  openStart: number,
  name: string,
  skip: ReadonlyArray<CodeRange> = [],
): number {
  const open = matchJsxTagOpen(text, openStart);
  if (!open || open.name !== name || open.selfClosing) return -1;
  const openRe = new RegExp(`^<${escapeRegExp(name)}((?:\\s[^>]*?)?)(\\/?)>`);
  const closeRe = new RegExp(`^<\\/${escapeRegExp(name)}\\s*>`);
  let depth = 1;
  let i = open.openEnd;
  while (i < text.length) {
    // A same-name open/close inside a fence or comment is an example, not nesting.
    const inSkip = skip.find(([rs, re]) => i >= rs && i < re);
    if (inSkip) {
      i = inSkip[1];
      continue;
    }
    if (text.charCodeAt(i) === 0x3c /* < */) {
      const tail = text.slice(i);
      const c = closeRe.exec(tail);
      if (c) {
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

function insideRanges(pos: number, ranges: ReadonlyArray<CodeRange>): boolean {
  for (const [rs, re] of ranges) {
    if (pos >= rs && pos < re) return true;
  }
  return false;
}

/**
 * Half-open `[start, end)` ranges of unknown JSX component tags (self-closing
 * AND paired) outside the registry. Opens inside `codeRanges` (fences,
 * multi-line comments) are skipped, and so is a closing tag inside them.
 * Unbalanced paired opens (no matching close) are skipped — not excluded — to
 * avoid over-excluding on malformed input. Used by `code-ranges.ts` so server
 * reference operations ignore refs inside JSX.
 */
export function findUnknownJsxRanges(
  text: string,
  codeRanges: ReadonlyArray<CodeRange> = [],
): CodeRange[] {
  const ranges: CodeRange[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x3c /* < */) {
      const open = matchJsxTagOpen(text, i);
      if (open && isPassthroughTag(open.name) && !insideRanges(i, codeRanges)) {
        if (open.selfClosing) {
          ranges.push([i, open.openEnd]);
          i = open.openEnd;
          continue;
        }
        const end = findJsxSpanEnd(text, i, open.name, codeRanges);
        if (end !== -1) {
          ranges.push([i, end]);
          i = end;
          continue;
        }
        // unbalanced open — leave it for normal processing
        i = open.openEnd;
        continue;
      }
    }
    i++;
  }
  return ranges;
}
