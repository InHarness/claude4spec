/**
 * Pre-process markdown text into placeholder markdown links so chips render
 * via the `a` component override in <ChatMarkdown />. Functionally equivalent
 * to a rehype plugin but avoids rehype-raw (no <script> injection vector —
 * malformed tags fall through and react-markdown drops them).
 *
 * Sanitization (whitelist + regex) runs here, before placeholders are emitted.
 * Tags that fail sanitization are passed through unchanged; react-markdown
 * without rehype-raw drops raw HTML, so the user sees nothing rather than a
 * dangerous chip.
 *
 * Code-aware: tags inside inline code spans or fenced code blocks are NOT
 * converted (see computeCodeRanges). A placeholder link emitted inside code
 * would be rendered verbatim by react-markdown, leaking `[__C4S_CHIP](#...)`
 * as visible text; leaving the raw tag instead renders the intended example
 * syntax.
 */
import { parseXmlTags, type XmlTag } from '../../shared/xml-tags.js';

export const CHIP_HREF_PREFIX = '#__c4s_chip__';

const SLUG_RE = /^[a-z0-9-]+$/;
const ANCHOR_RE = /^[a-z0-9]{6,12}$/;

export interface SanitizedChip {
  kind: string;
  attrs: Record<string, string>;
}

export function preprocessXmlChips(text: string, activeTypes: Set<string>): string {
  if (!text || (!text.includes('<inline_mention') && !text.includes('<single_element')
    && !text.includes('<element_list') && !text.includes('<tagged_list')
    && !text.includes('<section_ref'))) {
    return text;
  }
  const tags = parseXmlTags(text);
  if (!tags.length) return text;

  const codeRanges = computeCodeRanges(text);
  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    out += text.slice(cursor, tag.start);
    if (intersectsCode(tag.start, tag.end, codeRanges)) {
      // Inside an inline code span or fenced code block: leave the tag raw.
      // react-markdown renders code content verbatim (it never parses links
      // inside code), so a placeholder link here would leak as visible
      // `[__C4S_CHIP](#...)` text. Emitting the raw tag instead renders the
      // intended example syntax (e.g. `<inline_mention .../>`).
      out += text.slice(tag.start, tag.end);
    } else {
      const sanitized = sanitizeTag(tag, activeTypes);
      if (sanitized) {
        const payload = encodePayload(sanitized);
        out += `[__C4S_CHIP](${CHIP_HREF_PREFIX}${payload})`;
      } else {
        // Drop malformed tags (don't write tag.raw — would re-emit and confuse
        // downstream layers). Empty replacement = silent removal.
      }
    }
    cursor = tag.end;
  }
  out += text.slice(cursor);
  return out;
}

type CodeRange = [start: number, end: number]; // half-open [start, end)

/**
 * Compute char ranges that markdown treats as code (inline code spans and
 * fenced blocks), so chip conversion can skip them. An unclosed fence extends
 * to end-of-string — this matches how react-markdown parses a mid-stream
 * message (everything after an open fence is code until it closes) and keeps
 * the streaming-transient case showing the raw tag rather than a placeholder.
 *
 * Known gap: 4-space indented code blocks are not detected (rare in agent
 * output). Tilde fences are handled; tildes never start inline code.
 */
function computeCodeRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  const nonFenced: CodeRange[] = []; // gaps between fenced blocks, scanned for inline code
  const fenceRe = /^( {0,3})(`{3,}|~{3,})/;
  const len = text.length;

  // Phase 1: fenced code blocks (line scan, tracking absolute offsets).
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
      if (openLineStart > segStart) nonFenced.push([segStart, openLineStart]);
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
      ranges.push([openLineStart, blockEnd]);
      const after = text.indexOf('\n', blockEnd);
      i = after === -1 ? len : after + 1;
      segStart = i;
      continue;
    }
    i = nl === -1 ? len : nl + 1;
  }
  if (segStart < len) nonFenced.push([segStart, len]);

  // Phase 2: inline code spans within the non-fenced gaps. A run of N backticks
  // opens; the next run of exactly N backticks closes. Unmatched runs are
  // literal text, not code.
  for (const [gStart, gEnd] of nonFenced) {
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
          ranges.push([gStart + open.start, gStart + runs[q]!.start + runs[q]!.len]);
          k = q + 1;
          closed = true;
          break;
        }
      }
      if (!closed) k++;
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

function intersectsCode(start: number, end: number, ranges: CodeRange[]): boolean {
  for (const [rs, re] of ranges) {
    if (start < re && end > rs) return true;
    if (rs >= end) break;
  }
  return false;
}

function sanitizeTag(tag: XmlTag, activeTypes: Set<string>): SanitizedChip | null {
  const attrs = tag.attrs;
  switch (tag.kind) {
    case 'section_ref': {
      const anchor = attrs.anchor;
      if (!anchor || !ANCHOR_RE.test(anchor)) return null;
      return { kind: 'section_ref', attrs: { anchor } };
    }
    case 'inline_mention':
    case 'single_element': {
      const type = attrs.type;
      const slug = attrs.slug;
      if (!type || !activeTypes.has(type)) return null;
      if (!slug || !SLUG_RE.test(slug)) return null;
      return { kind: tag.kind, attrs: { type, slug } };
    }
    case 'element_list': {
      const type = attrs.type;
      if (!type || !activeTypes.has(type)) return null;
      const slugs = (attrs.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (slugs.length === 0 || !slugs.every((s) => SLUG_RE.test(s))) return null;
      return { kind: 'element_list', attrs: { type, slugs: slugs.join(',') } };
    }
    case 'tagged_list': {
      const type = attrs.type;
      if (!type || !activeTypes.has(type)) return null;
      const tags = (attrs.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (tags.length === 0 || !tags.every((s) => SLUG_RE.test(s))) return null;
      const filter = attrs.filter === 'or' ? 'or' : 'and';
      return { kind: 'tagged_list', attrs: { type, tags: tags.join(','), filter } };
    }
    case 'tagged_list_mixed': {
      const tags = (attrs.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (tags.length === 0 || !tags.every((s) => SLUG_RE.test(s))) return null;
      const filter = attrs.filter === 'or' ? 'or' : 'and';
      return { kind: 'tagged_list_mixed', attrs: { tags: tags.join(','), filter } };
    }
    default:
      return null;
  }
}

function encodePayload(chip: SanitizedChip): string {
  const json = JSON.stringify(chip);
  if (typeof btoa === 'function') {
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return encodeURIComponent(json);
}

export function decodePayload(payload: string): SanitizedChip | null {
  try {
    if (typeof atob === 'function' && /^[A-Za-z0-9_-]+$/.test(payload)) {
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
      const json = decodeURIComponent(escape(atob(pad)));
      const parsed = JSON.parse(json) as SanitizedChip;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null;
      return parsed;
    }
    const parsed = JSON.parse(decodeURIComponent(payload)) as SanitizedChip;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
