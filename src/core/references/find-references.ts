import {
  parseXmlTagsExcludingCode,
  tagMatchesEntity,
  taggedListVia,
} from '../../shared/xml-tags.js';
import type {
  FindReferencesDeps,
  FindReferencesOptions,
  SupersetHit,
} from './types.js';

/**
 * Serverless reference search (M19) — the single source of truth shared by the
 * REST endpoint, the MCP `find_references` tool, and the `c4s find-references`
 * CLI command. Walks every page once via the injected `pages` source.
 *
 *  - Phase 1 (always): static refs — explicit inline_mention / single_element /
 *    element_list tags matching `(type, slug)`. Rows carry `raw`.
 *  - Phase 2 (when `includeTagMatches`): dynamic refs — tagged_list /
 *    tagged_list_mixed tags whose `tags` intersect the entity's tag set, via the
 *    shared `taggedListVia` predicate. Rows carry `via`.
 */
export async function findReferences(
  deps: FindReferencesDeps,
  type: string,
  slug: string,
  options: FindReferencesOptions = {},
): Promise<SupersetHit[]> {
  const includeTagMatches = options.includeTagMatches === true;
  const pages = await deps.pages.listPages();
  const hits: SupersetHit[] = [];

  // Phase 1 — static references.
  for (const page of pages) {
    for (const tag of parseXmlTagsExcludingCode(page.body)) {
      if (tagMatchesEntity(tag, type, slug)) {
        hits.push({ rootId: page.rootId ?? 'pages', pagePath: page.path, tagType: tag.kind, line: tag.line, raw: tag.raw });
      }
    }
  }

  // Phase 2 — tag-driven references.
  if (includeTagMatches && deps.host?.entityExists(type, slug)) {
    const entityTags = new Set(deps.getEntityTagSlugs?.(type, slug) ?? []);
    if (entityTags.size > 0) {
      for (const page of pages) {
        for (const tag of parseXmlTagsExcludingCode(page.body)) {
          const via = taggedListVia(tag, type, entityTags);
          if (via.length === 0) continue;
          hits.push({ rootId: page.rootId ?? 'pages', pagePath: page.path, tagType: tag.kind, line: tag.line, via });
        }
      }
    }
  }

  return hits;
}
