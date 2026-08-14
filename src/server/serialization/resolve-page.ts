import { parseXmlTagsExcludingCode, type XmlTag } from '../../shared/xml-tags.js';
import {
  renderElementList,
  renderInlineMention,
  renderSingleElement,
  renderTaggedListMixed,
} from './inline-renderer.js';
import { getEntitiesAll, listEntitiesAll, type DiscoveryCore } from '../discovery/index.js';

/**
 * Expanding tags inline is a RENDER concern — the editor preview, the static
 * HTML export, `c4s resolve`. It is deliberately not a discovery operation: a
 * tag is an edge, and an agent reading the spec wants the edge, not a payload
 * pasted over it.
 *
 * M39 still routes the reads through the core rather than serializing here.
 * The renderer decides what a resolved tag LOOKS like; it does not get its own
 * copy of what an entity IS.
 *
 * 0.2.3 removed the external MCP `resolve_page` tool, so `c4s resolve` is now
 * this module's ONLY surface. That is the point rather than an accident: the
 * `resolved: [...]` sidecar and the `inline` variant have no successor as a read
 * contract for an agent, which asks `get_page` for the page as authored and
 * `get_entities` for the slug an embed carries. Do not re-expose this through a
 * tool — an expanded embed hands the consumer a payload where it had an edge.
 */
export interface ResolvePageDeps {
  discovery: DiscoveryCore;
  /** Active entity types, for the untyped `<tagged_list_mixed/>` sweep. */
  activeTypes: string[];
  /**
   * Every INSTALLED type, active or not. Only used to seed the
   * `<tagged_list_mixed>` group keys, so a deactivated type still reports `[]`
   * rather than vanishing from the payload. Defaults to `activeTypes`.
   */
  availableTypes?: string[];
}

export interface ResolvedEntry {
  tag: string;
  raw: string;
  position: { line: number; start: number; end: number };
  data?: unknown;
  inline?: string;
  generic?: boolean;
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
      if (outcome.generic) entry.generic = true;
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
  generic: boolean;
  error?: string;
}

function resolveTag(tag: XmlTag, deps: ResolvePageDeps): ResolveOutcome {
  switch (tag.kind) {
    /**
     * 0.2.22 — the tag kind picks a PROJECTION, not a view.
     *
     * A chip needs a label and a link, so it asks for the identity skeleton and
     * nothing else. A `single_element` renders the whole record, so it names no
     * projection and takes the default. Calls are grouped per (type, projection)
     * for the same reason they used to be grouped per (type, view).
     */
    case 'inline_mention':
      return resolveSingle(tag, deps, [], renderInlineMention);
    case 'single_element':
      return resolveSingle(tag, deps, undefined, renderSingleElement);
    case 'element_list':
      return resolveElementList(tag, deps);
    case 'tagged_list':
      return resolveTaggedList(tag, deps);
    case 'tagged_list_mixed':
      return resolveTaggedListMixed(tag, deps);
    case 'todo':
      return { data: null, inline: tag.raw, generic: false };
    default:
      return { data: null, inline: tag.raw, generic: false };
  }
}

function resolveSingle(
  tag: XmlTag,
  deps: ResolvePageDeps,
  select: string[] | undefined,
  render: (data: unknown) => string,
): ResolveOutcome {
  const typeRaw = tag.attrs.type ?? '';
  const slug = tag.attrs.slug ?? '';
  if (!slug) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: missing slug -->`,
      generic: true,
      error: 'missing_slug',
    };
  }
  const type = normalizeType(typeRaw, deps);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      generic: true,
      error: 'unknown_type',
    };
  }
  const record = deps.discovery.getEntities({
    type,
    slugs: [slug],
    ...(select ? { select } : {}),
  }).results[0];
  if (!record || record.entity === null) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: ${type}/${slug} not found -->`,
      generic: true,
      error: 'entity_not_found',
    };
  }
  /**
   * The record as the core produced it — nothing appended.
   *
   * 0.2.23: `withMeta` used to fold the serializer's `_generic` / `_error` into
   * the payload here. Neither exists any more; the record has one producer, and
   * a flag on the envelope below still reports the resolution outcomes this
   * function genuinely owns (unknown type, entity not found).
   */
  const data = record.entity;
  return { data, inline: render(data), generic: false };
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
      generic: true,
      error: 'unknown_type',
    };
  }
  // getEntitiesAll, not getEntities: the agent-facing op caps its slug list, and
  // an author who wrote 51 slugs on a page must still see 51 entities rendered
  // rather than an error comment where the list was.
  // `select: []` — a list row is a link and a label, which is exactly the
  // identity skeleton. Anything wider was a view's idea of what a row wanted.
  const { results } = getEntitiesAll(deps.discovery, { type, slugs, select: [] });
  const items = results.filter((r) => r.entity !== null).map((r) => r.entity);
  /**
   * `entity: null` alone is NOT "missing" — since 0.2.6 it also marks a row the
   * response budget could not carry, which `truncated` distinguishes. Rendering
   * one of those under `_missing:_` would print an affirmative "this entity does
   * not exist" onto the page about an entity that does exist: worse than the
   * silent omission it replaced, because a reader believes the page.
   *
   * `getEntitiesAll` re-asks for truncated rows one slug at a time, so in
   * practice none survive to here. The filter is the guarantee, not the
   * optimism.
   */
  const missing = results.filter((r) => r.entity === null && r.truncated !== true).map((r) => r.slug);
  const data = { items, missing };
  return {
    data,
    inline: renderElementList(items) + (missing.length ? `\n\n_missing: ${missing.join(', ')}_` : ''),
    generic: false,
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
      generic: true,
      error: 'unknown_type',
    };
  }
  const items = itemsFor(deps, type, tags, filter);
  return {
    data: { items, query: { type, tags, filter } },
    inline: renderElementList(items),
    generic: false,
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
  // 0.2.11: the seed is registry-driven. It used to name four types
  // unconditionally -- two of them (`endpoints`, `dtos`) contributed by a plugin
  // and one (`database-tables`) by an external one -- so the host asserted a
  // shape for types it must not name. Seeding from AVAILABLE types keeps the
  // reason the seed existed (a consumer reading `groups.endpoints.length` must
  // not hit `undefined` when the type is merely deactivated) without the frozen
  // list. `renderTaggedListMixed` skips empty groups, so rendered output is
  // unaffected either way.
  const groups: Record<string, unknown[]> = Object.fromEntries(
    (deps.availableTypes ?? deps.activeTypes).map((t) => [`${t}s`, [] as unknown[]]),
  );
  for (const type of deps.activeTypes) {
    groups[`${type}s`] = itemsFor(deps, type, tags, filter);
  }
  return {
    data: { ...groups, query: { tags, filter } },
    inline: renderTaggedListMixed(groups),
    generic: false,
  };
}

function itemsFor(
  deps: ResolvePageDeps,
  type: string,
  tags: string[],
  tagFilter: 'and' | 'or',
): unknown[] {
  /**
   * A rendered tagged list is complete or it is wrong: a reader cannot tell a
   * truncated list from a short one, so this exhausts the pages.
   *
   * The discovery row IS the rendered row now — `{ slug, title }` — so there is
   * no second call to widen it. That is the same projection the chip asks for,
   * arrived at from the other direction.
   */
  return listEntitiesAll(deps.discovery, { type, tags, tagFilter }).map((row) => ({
    type,
    slug: row.slug,
    title: row.title,
  }));
}

function normalizeType(raw: string, deps: ResolvePageDeps): string | null {
  // 0.2.11: the `database_table` -> `database-table` alias is gone. A type id is
  // always kebab-case, so the underscore spelling was not an alternative name
  // for anything -- and singling out one plugin type for a courtesy no other
  // type received is the privilege this release removes.
  return deps.activeTypes.includes(raw) ? raw : null;
}

