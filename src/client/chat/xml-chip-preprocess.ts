/**
 * Pre-process markdown text into placeholder markdown links so chips render
 * via the `a` component override in <ChatMarkdown />. Functionally equivalent
 * to a rehype plugin but avoids rehype-raw (no <script> injection vector —
 * malformed tags fall through and react-markdown drops them).
 *
 * 2.1.2 (M51) — WHICH tags become chips is a rule over the registry, not a
 * list of names: every registered tag whose target is an entity (a single one,
 * or entities picked by tags) or a section. A tag with another target, or none
 * (`todo` carries its own content), stays text. A tag added to the registry
 * with such a target shows up in chat with no change here. Tags are read with
 * the shared server parser.
 *
 * Sanitization (regex, by ATTRIBUTE name) runs here, before placeholders are
 * emitted: `slug` / `slugs` / `tags` as `^[a-z0-9-]+$`, `anchor` as
 * `^[a-z0-9]{6,12}$`, `type` as a type-name shape. A chip tag failing it is
 * dropped — react-markdown without rehype-raw would drop the raw HTML anyway.
 * 2.1.7 (M05) — a `type` outside the host's available types is NOT dropped:
 * it renders as the host's broken chip `[broken: <slug>]`, like a type with
 * no module.
 *
 * Code-aware (non-content ranges come from the shared M51 scanner):
 *  - Inline code whose ONLY content is chip tag(s), e.g. `<inline_mention .../>`:
 *    the surrounding backticks are stripped so the tag renders as a chip. The
 *    agent is shown the tag grammar in backticks (chat-context prompt) and often
 *    echoes that formatting; unwrapping keeps such refs working as chips.
 *  - Fenced code blocks, and inline code mixing a tag with other text: tags are
 *    left raw (deliberate syntax examples). A placeholder link emitted inside
 *    code would be rendered verbatim by react-markdown, leaking
 *    `[__C4S_CHIP](#...)`; the raw tag is the readable fallback instead.
 */
import { findXmlTagCandidates, parseXmlTags, type XmlTag } from '../../shared/xml-tags.js';
import { findInlineCodeSpans, maskTagAttributeValues, scanFences } from '../../shared/code-ranges.js';
import { getXmlTag, type XmlTagDefinition } from '../../shared/xml-markup/registry.js';

export const CHIP_HREF_PREFIX = '#__c4s_chip__';

const SLUG_RE = /^[a-z0-9-]+$/;
/** The shape of an entity type name — a guard on the payload, not a whitelist. */
const TYPE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const ANCHOR_RE = /^[a-z0-9]{6,12}$/;

export interface SanitizedChip {
  kind: string;
  attrs: Record<string, string>;
}

export type ChipTarget = 'entity' | 'entities-by-tags' | 'section';

/**
 * The target of a registered tag, read from its attribute vocabulary: an
 * `anchor` points at a section, a `slug` / `slugs` at entities, `tags` at
 * entities picked by tags. `null` — the tag points at nothing a chip can show.
 */
export function chipTargetOf(def: Pick<XmlTagDefinition, 'attrOrder'>): ChipTarget | null {
  const attrs = new Set(def.attrOrder);
  if (attrs.has('anchor')) return 'section';
  if (attrs.has('slug') || attrs.has('slugs')) return 'entity';
  if (attrs.has('tags')) return 'entities-by-tags';
  return null;
}

/** True for a registered tag the chat renders as a chip. */
export function isChipTag(kind: string): boolean {
  const def = getXmlTag(kind);
  return !!def && chipTargetOf(def) !== null;
}

export function preprocessXmlChips(text: string): string {
  if (!text || !text.includes('<')) return text;
  if (!findXmlTagCandidates(text).some((t) => isChipTag(t.kind))) return text;
  // Strip backticks around inline-code spans that contain only chip tag(s), so
  // a ref the agent wrapped in `...` still renders as a chip. Done before tag
  // conversion so the now-bare tag falls outside any code range below.
  const unwrapped = unwrapChipOnlyInlineCode(text);

  // Live tags only — those in code are syntax examples and stay raw: react-
  // markdown renders code verbatim, so a placeholder there would leak as text.
  const tags = parseXmlTags(unwrapped).filter((t) => isChipTag(t.kind));
  if (!tags.length) return unwrapped;

  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    out += unwrapped.slice(cursor, tag.start);
    const sanitized = sanitizeTag(tag);
    // A malformed chip tag is dropped (writing `tag.raw` back would re-emit it
    // and confuse downstream layers): empty replacement = silent removal.
    if (sanitized) out += `[__C4S_CHIP](${CHIP_HREF_PREFIX}${encodePayload(sanitized)})`;
    cursor = tag.end;
  }
  out += unwrapped.slice(cursor);
  return out;
}

/** True when `inner` is composed solely of chip tag(s) and whitespace. */
function isChipOnly(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed.startsWith('<')) return false;
  const tags = findXmlTagCandidates(trimmed);
  if (!tags.length || !tags.every((t) => isChipTag(t.kind))) return false;
  let cursor = 0;
  for (const tag of tags) {
    if (trimmed.slice(cursor, tag.start).trim() !== '') return false;
    cursor = tag.end;
  }
  return trimmed.slice(cursor).trim() === '';
}

/**
 * Replace inline-code spans whose content is only chip tag(s) with the bare
 * tag(s), dropping the backticks. The conversion pass then turns those bare
 * tags into chips. Fenced blocks and mixed-content inline code are untouched.
 */
function unwrapChipOnlyInlineCode(text: string): string {
  if (!text.includes('`')) return text;
  const { gaps } = scanFences(text);
  const spans = findInlineCodeSpans(maskTagAttributeValues(text, gaps), gaps);
  if (!spans.length) return text;
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    const inner = text.slice(span.innerStart, span.innerEnd);
    if (!isChipOnly(inner)) continue;
    out += text.slice(cursor, span.start);
    out += inner.trim();
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out;
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Generic, by attribute name — every attribute the tag declares and the chat
 * knows how to check must pass; any other attribute (e.g. `caption`) is not
 * carried into the chip.
 */
export function sanitizeTag(tag: Pick<XmlTag, 'kind' | 'attrs'>): SanitizedChip | null {
  const def = getXmlTag(tag.kind);
  if (!def) return null;
  const out: Record<string, string> = {};
  for (const name of def.attrOrder) {
    const value = tag.attrs[name];
    switch (name) {
      case 'type':
        if (!value || !TYPE_RE.test(value)) return null;
        out.type = value;
        break;
      case 'slug':
        if (!value || !SLUG_RE.test(value)) return null;
        out.slug = value;
        break;
      case 'slugs':
      case 'tags': {
        const items = csv(value);
        if (items.length === 0 || !items.every((s) => SLUG_RE.test(s))) return null;
        out[name] = items.join(',');
        break;
      }
      case 'anchor':
        if (!value || !ANCHOR_RE.test(value)) return null;
        out.anchor = value;
        break;
      case 'filter':
        out.filter = value === 'or' ? 'or' : 'and';
        break;
      default:
        break;
    }
  }
  return { kind: tag.kind, attrs: out };
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
