import { parseXmlTagsExcludingCode, type XmlTag } from '../../shared/xml-tags.js';
import { isRawEntityType, type RawEntity, type RawEntityReader } from '../domain/raw-entity-reader.js';
import {
  renderElementList,
  renderInlineMention,
  renderSingleElement,
  renderTaggedListMixed,
} from './inline-renderer.js';
import { serializationEngine } from '../core/plugin-host/serialization-engine.js';
import type { SerializeResult } from './types.js';

export interface ResolvePageDeps {
  reader: RawEntityReader;
  registry: typeof serializationEngine;
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
  const type = normalizeType(typeRaw);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      fallback: true,
      error: 'unknown_type',
    };
  }
  const entity = deps.reader.getEntity(type, slug);
  if (!entity) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: ${type}/${slug} not found -->`,
      fallback: true,
      error: 'entity_not_found',
    };
  }
  const result = deps.registry.serializeEntity(type, view, entity, deps.reader);
  const data = withMeta(result);
  return {
    data,
    inline: render(data),
    fallback: result.fallback,
    ...(result.error ? { error: result.error } : {}),
  };
}

function resolveElementList(tag: XmlTag, deps: ResolvePageDeps): ResolveOutcome {
  const typeRaw = tag.attrs.type ?? '';
  const slugs = (tag.attrs.slugs ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const type = normalizeType(typeRaw);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      fallback: true,
      error: 'unknown_type',
    };
  }
  const { items: entities, missing } = deps.reader.getEntities(type, slugs);
  const items = entities.map((entity: RawEntity) =>
    withMeta(deps.registry.serializeEntity(type, 'element_list_item', entity, deps.reader)),
  );
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
  const type = normalizeType(typeRaw);
  if (!type) {
    return {
      data: null,
      inline: `${tag.raw}\n<!-- c4s resolve: unknown type '${typeRaw}' -->`,
      fallback: true,
      error: 'unknown_type',
    };
  }
  const entities = deps.reader.findByTag({ type, tags, filter });
  const items = entities.map((entity) =>
    withMeta(deps.registry.serializeEntity(type, 'tagged_list_item', entity, deps.reader)),
  );
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
  const entities = deps.reader.findByTag({ tags, filter });
  const groups: Record<string, unknown[]> = {
    endpoints: [],
    dtos: [],
    'database-tables': [],
    'ui-views': [],
  };
  const bucket: Record<string, string> = {
    endpoint: 'endpoints',
    dto: 'dtos',
    'database-table': 'database-tables',
    'ui-view': 'ui-views',
  };
  for (const entity of entities) {
    const item = withMeta(
      deps.registry.serializeEntity(entity.type, 'tagged_list_item', entity, deps.reader),
    );
    const key = bucket[entity.type];
    if (key) groups[key]!.push(item);
  }
  return {
    data: { ...groups, query: { tags, filter } },
    inline: renderTaggedListMixed(groups),
    fallback: false,
  };
}

function normalizeType(raw: string) {
  const normalized = raw === 'database_table' ? 'database-table' : raw;
  if (isRawEntityType(normalized)) return normalized;
  return null;
}

function withMeta(result: SerializeResult): unknown {
  if (!result.fallback && !result.error) return result.data;
  if (typeof result.data === 'object' && result.data !== null) {
    return {
      ...(result.data as object),
      ...(result.fallback ? { _fallback: true } : {}),
      ...(result.error ? { _error: result.error } : {}),
    };
  }
  return result.data;
}
