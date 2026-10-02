import { scanExcluded, intersectsCode, type CodeRange } from './code-ranges.js';
import { getXmlTag } from './xml-markup/registry.js';
import { readAttrs, registeredTagRegex } from './xml-markup/pattern.js';

/**
 * M51 — THE server parser and serializer of XML markup tags. Every server-side
 * read and write of a tag goes through here: target resolution, rewrite after
 * a slug / anchor change, the section and todo indexers, the consistency
 * check, find_references, reference-tools. The contract is byte-exact: a
 * rewrite leaves the raw markdown untouched and changes only the serialized
 * tag, which is why this is deliberately NOT a markdown tokenizer.
 *
 * Names come from the registry (`xml-markup/registry.ts`) — none is written
 * down here.
 */
export interface XmlTag {
  /** The registered tag name. */
  kind: string;
  attrs: Record<string, string>;
  raw: string;
  /** Absolute offset of `<`. */
  start: number;
  /** Absolute offset just past `>`. */
  end: number;
  /** 1-based line of `start`. */
  line: number;
}

/**
 * Every occurrence of a registered tag, code or not, sorted by offset. The
 * candidates step of the non-content scan (`code-ranges.ts`) — every other
 * caller wants {@link parseXmlTags}.
 */
export function findXmlTagCandidates(md: string): XmlTag[] {
  const re = registeredTagRegex();
  if (!re) return [];
  const out: XmlTag[] = [];
  let line = 1;
  let lineCursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const raw = m[0];
    const start = m.index;
    for (let i = lineCursor; i < start; i++) if (md.charCodeAt(i) === 10) line++;
    lineCursor = start;
    out.push({ kind: m[1]!, attrs: readAttrs(m[2] ?? ''), raw, start, end: start + raw.length, line });
  }
  return out;
}

export interface ParseXmlTagsOptions {
  /**
   * Non-content ranges already computed by the caller's scan of the SAME text
   * (e.g. the section parser's `excludedRanges`) — one scanner, one result for
   * every consumer. Omitted → computed here.
   */
  ranges?: readonly CodeRange[];
}

/**
 * The registered tags of `md` that are live content: each with its name,
 * attributes and exact position. Tags inside non-content ranges — fenced and
 * inline code, unknown JSX regions, multi-line HTML comments — are syntax
 * examples and are dropped. Retained tags keep their absolute offsets, so a
 * caller splicing the body by offset is unaffected: dropping a tag is exactly
 * equivalent to leaving it verbatim.
 */
export function parseXmlTags(md: string, opts: ParseXmlTagsOptions = {}): XmlTag[] {
  const tags = findXmlTagCandidates(md);
  if (tags.length === 0) return tags;
  const ranges = opts.ranges ?? scanExcluded(md).ranges;
  if (ranges.length === 0) return tags;
  return tags.filter((t) => !intersectsCode(t.start, t.end, ranges as CodeRange[]));
}

/**
 * Writes a tag from a flat attribute set, in the registry's attribute order —
 * no editor dependency. `null` / `undefined` are absent and skipped; an empty
 * string is a present attribute and is kept, so a tag round-trips byte-for-byte
 * (`<todo comment=""/>` stays as is, and a tag written without `caption` never
 * gains `caption=""`). With no attributes the tag is written `<name />` — the
 * form the parser recognises.
 */
export function serializeXmlTag(
  kind: string,
  attrs: Record<string, string | null | undefined>,
): string {
  const def = getXmlTag(kind);
  if (!def) {
    throw new Error(`Unknown XML tag kind: ${kind}`);
  }
  const parts: string[] = [];
  for (const key of def.attrOrder) {
    const value = attrs[key];
    if (value == null) continue;
    parts.push(`${key}="${escapeAttr(value)}"`);
  }
  return parts.length > 0 ? `<${kind} ${parts.join(' ')}/>` : `<${kind} />`;
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;');
}

/**
 * Only the M19 entity tags carry entity slugs, and the entity type is always
 * spelled out in `type=` — no tag name encodes a type.
 */
export function extractSlugs(tag: XmlTag): string[] {
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug ? [tag.attrs.slug] : [];
  }
  if (tag.kind === 'element_list') {
    return (tag.attrs.slugs ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractTags(tag: XmlTag): string[] {
  if (tag.kind === 'tagged_list' || tag.kind === 'tagged_list_mixed') {
    return (tag.attrs.tags ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * True when a static tag (inline_mention / single_element / element_list)
 * explicitly references the entity `(entityType, slug)`. tagged_list /
 * tagged_list_mixed never match here — those are dynamic, tag-driven refs
 * resolved via `taggedListVia`. Single source of truth for static reference
 * matching — used by the references core (M19) and ReferencesService.
 */
export function tagMatchesEntity(tag: XmlTag, entityType: string, slug: string): boolean {
  if (tag.kind === 'tagged_list_mixed') return false;
  if (tag.attrs.type !== entityType) return false;
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug === slug;
  }
  if (tag.kind === 'element_list') {
    return (tag.attrs.slugs ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(slug);
  }
  return false;
}

/**
 * Matched tag slugs ("via") when a tagged_list / tagged_list_mixed node references an
 * entity of `entityType` carrying `entityTags`; [] when it does not match.
 * Single source of truth for tag-driven reference matching — used by both
 * find_references(includeTagMatches) and check_consistency rule 3.
 */
export function taggedListVia(
  tag: XmlTag,
  entityType: string,
  entityTags: ReadonlySet<string>,
): string[] {
  if (tag.kind !== 'tagged_list' && tag.kind !== 'tagged_list_mixed') return [];
  if (tag.kind === 'tagged_list' && tag.attrs.type !== entityType) return [];
  return extractTags(tag).filter((t) => entityTags.has(t));
}
