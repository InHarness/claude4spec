import { parseXmlTagsExcludingCode, type XmlTag } from '../../shared/xml-tags.js';
import {
  renderElementList,
  renderInlineMention,
  renderSingleElement,
  renderTaggedListMixed,
} from './inline-renderer.js';
import { getEntitiesAll, listEntitiesAll, type DiscoveryCore, type SerializedMeta } from '../discovery/index.js';

/**
 * Expanding tags inline is a RENDER concern — the editor preview, the static
 * HTML export, `c4s resolve`. It is deliberately not a discovery operation: a
 * tag is an edge, and an agent reading the spec wants the edge, not a payload
 * pasted over it.
 *
 * M39 still routes the reads through the core rather than serializing here.
 * The renderer decides what a resolved tag LOOKS like; it does not get its own
 * copy of what an entity IS.
 */
export interface ResolvePageDeps {
  discovery: DiscoveryCore;
  /** Active entity types, for the untyped `<tagged_list_mixed/>` sweep. */
  activeTypes: string[];
}

export interface ResolvedEntry {
  tag: string;
  raw: string;
  position: { line: number; start: number; end: number };
  data?: unknown;
  inline?: string;
  fallback?: boolean;
  error?: string;
}

export interface ResolvePageResult {
  resolved: ResolvedEntry[];
  inlineContent: string;
}

export function resolvePageContent(md: string, deps: ResolvePageDeps): ResolvePageResult {
  const tags = parseXmlTagsExcludingCode(md);
  const resolved: ResolvedEntry[] = [];
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const tag of tags) {
    const entry: ResolvedEntry = {
      tag: tag.kind,
      raw: tag.raw,
      position: { line: tag.line, start: tag.start, end: tag.end },
    };
    try {
      const outcome = resolveTag(tag, deps);
      entry.data = outcome.data;
      entry.inline = outcome.inline;
      if (outcome.fallback) entry.fallback = true;
      if (outcome.error) entry.error = outcome.error;
      replacements.push({ start: tag.start, end: tag.end, replacement: outcome.inline });
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      const replacement = `${tag.raw}\n<!-- c4s resolve: ${entry.error} -->`;
      entry.inline = replacement;
      replacements.push({ start: tag.start, end: tag.end, replacement });
    }
    resolved.push(entry);
  }

  replacements.sort((a, b) => b.start - a.start);
  let inlineContent = md;
  for (const r of replacements) {
    inlineContent = inlineContent.slice(0, r.start) + r.replacement + inlineContent.slice(r.end);
  }

  return { resolved, inlineContent };
}

interface ResolveOutcome {
  data: unknown;
  inline: string;
  fallback: boolean;
  error?: string;
}

function resolveTag(tag: XmlTag, deps: ResolvePageDeps): ResolveOutcome {
  switch (tag.kind) {
    case 'inline_mention':
      return resolveSingle(tag, deps, 'inline_mention', renderInlineMention);
    case 'single_element':
      return resolveSingle(tag, deps, 'single_element', renderSingleElement);
    case 'element_list':
      return resolveElementList(tag, deps);
    case 'tagged_list':
      return resolveTaggedList(tag, deps);
    case 'tagged_list_mixed':
      return resolveTaggedListMixed(tag, deps);
    case 'todo':
      return { data: null, inline: tag.raw, fallback: false };
    default:
      return { data: null, inline: tag.raw, fallback: false };
  }
}

function resolveSingle(
  tag: XmlTag,
  deps: ResolvePageDeps,
  view: 'inline_mention' | 'single_element',
  render: (data: unknown) => string,
): ResolveOutcome {
  const typeRaw = tag.attrs.type ?? '';
  const slug = tag.attrs.slug ?? '';
  if (!slug) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: missing slug -->`,
      fallback: true,
      error: 'missing_slug',
    };
  }
  const type = normalizeType(typeRaw, deps);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      fallback: true,
      error: 'unknown_type',
    };
  }
  const record = deps.discovery.getEntities({ type, slugs: [slug], view }).results[0];
  if (!record || record.entity === null) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: ${type}/${slug} not found -->`,
      fallback: true,
      error: 'entity_not_found',
    };
  }
  const data = withMeta(record.entity, record);
  return {
    data,
    inline: render(data),
    fallback: record.fallback === true,
    ...(record.error ? { error: record.error } : {}),
  };
}

function resolveElementList(tag: XmlTag, deps: ResolvePageDeps): ResolveOutcome {
  const typeRaw = tag.attrs.type ?? '';
  const slugs = (tag.attrs.slugs ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const type = normalizeType(typeRaw, deps);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      fallback: true,
      error: 'unknown_type',
    };
  }
  // getEntitiesAll, not getEntities: the agent-facing op caps its slug list, and
  // an author who wrote 51 slugs on a page must still see 51 entities rendered
  // rather than an error comment where the list was.
  const results = getEntitiesAll(deps.discovery, { type, slugs, view: 'element_list_item' });
  const items = results.filter((r) => r.entity !== null).map((r) => withMeta(r.entity, r));
  const missing = results.filter((r) => r.entity === null).map((r) => r.slug);
  const data = { items, missing };
  return {
    data,
    inline: renderElementList(items) + (missing.length ? `\n\n_missing: ${missing.join(', ')}_` : ''),
    fallback: false,
  };
}

function resolveTaggedList(tag: XmlTag, deps: ResolvePageDeps): ResolveOutcome {
  const typeRaw = tag.attrs.type ?? '';
  const tags = (tag.attrs.tags ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const filter = tag.attrs.filter === 'and' ? 'and' : 'or';
  const type = normalizeType(typeRaw, deps);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      fallback: true,
      error: 'unknown_type',
    };
  }
  const items = itemsFor(deps, type, tags, filter);
  return {
    data: { items, query: { type, tags, filter } },
    inline: renderElementList(items),
    fallback: false,
  };
}

function resolveTaggedListMixed(tag: XmlTag, deps: ResolvePageDeps): ResolveOutcome {
  const tags = (tag.attrs.tags ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const filter = tag.attrs.filter === 'and' ? 'and' : 'or';
  // The bucket key was a hardcoded map of four core types, so a tagged entity
  // of any other type silently vanished from a mixed list. Every one of those
  // four keys was the type name plus an `s`, so deriving it covers the same
  // four identically and stops dropping the rest.
  // The four original keys are seeded FIRST and unconditionally: a consumer
  // doing `groups.endpoints.length` must keep reading 0 when the type is
  // deactivated or its plugin failed to load, not throw on `undefined`.
  const groups: Record<string, unknown[]> = { endpoints: [], dtos: [], 'database-tables': [], 'ui-views': [] };
  for (const type of deps.activeTypes) {
    groups[`${type}s`] = itemsFor(deps, type, tags, filter);
  }
  return {
    data: { ...groups, query: { tags, filter } },
    inline: renderTaggedListMixed(groups),
    fallback: false,
  };
}

function itemsFor(
  deps: ResolvePageDeps,
  type: string,
  tags: string[],
  filter: 'and' | 'or',
): unknown[] {
  // A rendered tagged list is complete or it is wrong: a reader cannot tell a
  // truncated list from a short one, so this exhausts the pages.
  return listEntitiesAll(deps.discovery, { type, tags, filter, view: 'tagged_list_item' }).map((item) =>
    withMeta(item.data, item),
  );
}

function normalizeType(raw: string, deps: ResolvePageDeps): string | null {
  // `database_table` is the underscore spelling authors write in a tag; the
  // type's canonical id is hyphenated.
  const normalized = raw === 'database_table' ? 'database-table' : raw;
  return deps.activeTypes.includes(normalized) ? normalized : null;
}

function withMeta(data: unknown, meta: SerializedMeta): unknown {
  if (!meta.fallback && !meta.error) return data;
  if (typeof data === 'object' && data !== null) {
    return {
      ...(data as object),
      ...(meta.fallback ? { _fallback: true } : {}),
      ...(meta.error ? { _error: meta.error } : {}),
    };
  }
  return data;
}
