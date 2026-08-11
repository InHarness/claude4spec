/**
 * M39 — turning a section row into a section with a BODY and its EDGES.
 *
 * Two of the three gaps the motivating session exposed live here. `get_section`
 * used to return coordinates and nothing else, so an agent that found the right
 * section still had to go read the file by hand. And the edges were left as raw
 * markdown for the consumer to parse, which meant every consumer parsed them
 * differently or not at all.
 *
 * The body is AS AUTHORED. Expanding an `<inline_mention/>` would paste an
 * entity payload into the prose and destroy the edge — the tag is the edge. An
 * agent that wants the entity behind a tag calls `get_entities` with the slug
 * the edge already handed it.
 *
 * Parsing happens once, server-side, with the SAME parser the section indexer
 * uses. A second parser here would be a second definition of what a reference
 * is.
 */

import type { Database } from 'better-sqlite3';
import { parseXmlTagsExcludingCode } from '../../shared/xml-tags.js';
import { extractSlugs, extractTags } from '../../shared/xml-tags.js';
import { parseLinks } from '../services/pages-link-indexer.js';
import type { PageSource } from './page-source.js';
import type { RawSection } from './raw-entity-reader.js';
import type { SectionEdges } from './types.js';

export interface HydratedSection extends RawSection {
  body: string;
  edges: SectionEdges;
}

/**
 * Slices the section's body out of its page.
 *
 * `lineStart` is the 1-based heading line and `lineEnd` is the 1-based
 * inclusive last line, which is exactly the indexer's own convention
 * (`lines.slice(startLine, endLine)` over a 0-based array). Reproducing that
 * arithmetic rather than re-deriving it keeps the body identical to what was
 * hashed into `content_hash`.
 */
export function sliceBody(pageContent: string, section: RawSection, includeSubtree = false): string {
  const lines = pageContent.split('\n');
  const end = includeSubtree ? subtreeEnd(lines, section) : section.lineEnd;
  return lines.slice(section.lineStart, end).join('\n');
}

/**
 * With `includeSubtree`, the section runs to the next heading of the SAME OR
 * SHALLOWER level — i.e. it swallows its children. That is the middle of the
 * three read granularities (page / subtree / section), each with its own budget.
 */
function subtreeEnd(lines: string[], section: RawSection): number {
  for (let i = section.lineStart; i < lines.length; i++) {
    const match = /^(#{1,6})\s+\S/.exec(lines[i] ?? '');
    if (match && match[1]!.length <= section.headingLevel) return i;
  }
  return lines.length;
}

export async function hydrateSection(
  db: Database,
  pages: PageSource,
  section: RawSection,
  includeSubtree = false,
): Promise<HydratedSection> {
  // readBody, NOT read: `line_start`/`line_end` index the frontmatter-stripped
  // body (see PageSource.readBody). Slicing the raw file by them shifts every
  // section by the height of the frontmatter block.
  const pageContent = await pages.readBody(section.rootId, section.pagePath);
  const body = sliceBody(pageContent, section, includeSubtree);
  return { ...section, body, edges: parseEdges(db, section, body) };
}

/** Byte size of a section's body — what `list_sections` reports so a caller can measure before fetching. */
export function bodySize(pageContent: string, section: RawSection): number {
  return Buffer.byteLength(sliceBody(pageContent, section), 'utf8');
}

export function parseEdges(db: Database, section: RawSection, body: string): SectionEdges {
  const edges: SectionEdges = { sectionRefs: [], entityEmbeds: [], pageLinks: [] };

  // 0.2.16 — identifiers only. An edge says what to fetch next; it does not
  // reproduce the markdown it was parsed from, and it does not carry a line
  // number nothing addresses. Order of occurrence within the section is the one
  // positional fact that survives, and it survives as array order.
  for (const tag of parseXmlTagsExcludingCode(body)) {
    if (tag.kind === 'section_ref') {
      const anchor = tag.attrs.anchor;
      if (anchor) edges.sectionRefs.push({ anchor });
      continue;
    }
    if (tag.kind === 'todo') continue;

    const slugs = extractSlugs(tag);
    const tags = extractTags(tag);
    // 0.2.15 — the type is the `type` attribute, always. No tag encodes it in
    // its name any more.
    const type = tag.attrs.type ?? '';
    if (!type && !tags.length) continue;
    edges.entityEmbeds.push({
      tagType: tag.kind,
      type,
      ...(slugs.length === 1 ? { slug: slugs[0] } : {}),
      ...(slugs.length > 1 ? { slugs } : {}),
      ...(tags.length ? { tags } : {}),
      ...(tag.attrs.filter ? { filter: tag.attrs.filter } : {}),
    });
  }

  for (const link of parseLinks(body).candidates) {
    edges.pageLinks.push({
      // A link is written relative to the page it is on, so it resolves inside
      // the same root unless the root declares link targets — which the link
      // syntax itself cannot express, so the section's own root is the honest
      // answer here.
      rootId: section.rootId,
      path: link.targetPath,
      ...(link.anchor ? { anchor: link.anchor } : {}),
    });
  }

  // The structural half: `section_entity_link` is written by the indexer with
  // the same tag parser, and it is the join the graph is actually built on.
  // Anything it knows that the prose scan missed (a tag inside a construct the
  // parser excludes) still belongs in the edges.
  const linked = db
    .prepare('SELECT entity_type AS type, entity_slug AS slug FROM section_entity_link WHERE anchor = ?')
    .all(section.anchor) as Array<{ type: string; slug: string }>;
  for (const row of linked) {
    const already = edges.entityEmbeds.some((e) => e.type === row.type && (e.slug === row.slug || e.slugs?.includes(row.slug)));
    if (already) continue;
    edges.entityEmbeds.push({ tagType: 'section_entity_link', type: row.type, slug: row.slug });
  }

  return edges;
}
