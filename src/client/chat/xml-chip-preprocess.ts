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

  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    out += text.slice(cursor, tag.start);
    const sanitized = sanitizeTag(tag, activeTypes);
    if (sanitized) {
      const payload = encodePayload(sanitized);
      out += `[__C4S_CHIP](${CHIP_HREF_PREFIX}${payload})`;
    } else {
      // Drop malformed tags (don't write tag.raw — would re-emit and confuse
      // downstream layers). Empty replacement = silent removal.
    }
    cursor = tag.end;
  }
  out += text.slice(cursor);
  return out;
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
