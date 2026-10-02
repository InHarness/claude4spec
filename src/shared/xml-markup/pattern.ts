import { listXmlTags, xmlTagsVersion } from './registry.js';

/**
 * M51 — the ONE tag pattern, built from the registered names. Shared by the
 * server parser (`xml-tags.ts`) and the editor's markdown-it rules
 * (`client/tiptap/extensions/xmlNodes.ts`), so the same text yields the same
 * set of recognised tags on both sides.
 *
 * At least one whitespace after the name is required: `<name />` (no
 * attributes, with a space) is recognised with an empty attribute set,
 * `<name/>` is not. Attribute values are quote-aware, so a `>` inside
 * `caption="a > b"` does not cut the tag short.
 *
 * Group 1 = name, group 2 = attribute body.
 */
const ATTR_BODY = '((?:[^>"]|"[^"]*")*?)';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namesAlternation(names: readonly string[]): string {
  // Longest first, so `tagged_list_mixed` is never shadowed by `tagged_list`
  // (the mandatory whitespace already prevents a prefix match; this keeps the
  // alternation readable in debuggers).
  return [...names].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
}

/** Source of the tag pattern for an explicit name set (no anchors, no flags). */
export function tagPatternSource(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `<(${namesAlternation(names)})\\s+${ATTR_BODY}\\/?>`;
}

let cached: { version: number; source: string | null } | null = null;

/** Pattern source over every registered name; `null` while the registry is empty. */
export function registeredTagPatternSource(): string | null {
  const v = xmlTagsVersion();
  if (!cached || cached.version !== v) {
    cached = { version: v, source: tagPatternSource(listXmlTags().map((t) => t.name)) };
  }
  return cached.source;
}

/** A fresh global regex over every registered name; `null` while the registry is empty. */
export function registeredTagRegex(): RegExp | null {
  const src = registeredTagPatternSource();
  return src ? new RegExp(src, 'g') : null;
}

const ATTR_REGEX = /(\w+)="([^"]*)"/g;

/** Flat `name="value"` attributes of a tag's attribute body. */
export function readAttrs(attrBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_REGEX.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = ATTR_REGEX.exec(attrBody)) !== null) {
    const key = a[1];
    const value = a[2];
    if (key !== undefined && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

let anchoredCache: { version: number; re: RegExp | null } | null = null;

/** The registered-tag pattern anchored at the start (`^`), for tokenizers that match at a position. */
export function registeredTagRegexAnchored(): RegExp | null {
  const v = xmlTagsVersion();
  if (!anchoredCache || anchoredCache.version !== v) {
    const src = registeredTagPatternSource();
    anchoredCache = { version: v, re: src ? new RegExp(`^${src}`) : null };
  }
  return anchoredCache.re;
}
