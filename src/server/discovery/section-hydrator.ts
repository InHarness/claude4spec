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
import { headingStart, parseHeadings } from '../services/section-indexer.js';
import type { PageSource } from './page-source.js';
import type { RawSection } from './raw-entity-reader.js';
import type { SectionEdges } from './types.js';

export interface HydratedSection extends RawSection {
  body: string;
  edges: SectionEdges;
}

/**
 * Slices the section's OWN body out of its page.
 *
 * `lineStart` is the 1-based heading line and `lineEnd` is the 1-based
 * inclusive last line, which is exactly the indexer's own convention
 * (`lines.slice(startLine, endLine)` over a 0-based array). Reproducing that
 * arithmetic rather than re-deriving it keeps the body aligned with what was
 * indexed.
 *
 * 0.2.84 — the body ends at the FIRST HEADING OF A CHILD, not at the next
 * heading of the same or shallower level. The indexed `line_end` still runs to
 * the latter (the write side — `replace`, `delete`, `content_hash` — lives off
 * that range), so an H1 row's index range carries a whole page while its BODY
 * here carries only the prose above its first `##`. There is no
 * `includeSubtree` variant any more: with the flag, `get_sections` widens the
 * SET of items rather than any one item's body, so every item — parent
 * included — is sliced by this one function, and `get_page_outline`'s `size`
 * (which calls `bodySize` below) measures exactly what `get_sections` yields
 * at either setting.
 */
export function sliceBody(pageContent: string, section: RawSection): string {
  const lines = pageContent.split('\n');
  return lines.slice(section.lineStart, ownBodyEnd(lines, section)).join('\n');
}

/**
 * Where a section's OWN body ends: the start of the first heading after its own
 * (any level), capped by the indexed `lineEnd`. A shallower or equal heading is
 * already what `lineEnd` points at, so the cap only bites on pages where the
 * index and the file have drifted apart.
 *
 * The end comes from `headingStart`, the indexer's own definition, rather than
 * from a heading scan of its own. A hand-rolled scan stopped at the next heading
 * LINE — which left that heading's anchor comment inside the previous body,
 * handing a reader an identity belonging to the section after the one it asked
 * for (0.2.75).
 */
export function ownBodyEnd(lines: readonly string[], section: RawSection): number {
  const next = parseHeadings(lines as string[]).find((h) => h.lineIndex >= section.lineStart);
  const end = next ? headingStart(next) : lines.length;
  return Math.min(end, section.lineEnd);
}

export async function hydrateSection(db: Database, pages: PageSource, section: RawSection): Promise<HydratedSection> {
  // readBody, NOT read: `line_start`/`line_end` index the frontmatter-stripped
  // body (see PageSource.readBody). Slicing the raw file by them shifts every
  // section by the height of the frontmatter block.
  return hydrateSectionFrom(db, await pages.readBody(section.rootId, section.pagePath), section);
}

/**
 * The same hydration over page content the caller already holds. A subtree
 * expansion hands `get_sections` up to fifty sections of ONE page, and reading
 * that page once per section would be fifty reads for one file.
 */
export function hydrateSectionFrom(db: Database, pageContent: string, section: RawSection): HydratedSection {
  const body = sliceBody(pageContent, section);
  return { ...section, body, edges: parseEdges(db, section, body) };
}

/** Byte size of a section's own body — what `get_page_outline` reports so a caller can measure before fetching. */
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
  // Anything it knows that the prose scan missed (a `tagged_list` resolved to
  // the entities it lists) still belongs in the edges.
  //
  // 0.2.84 — MINUS whatever a DESCENDANT section links. The index derives a
  // section's links from its whole indexed range, which runs over its subtree,
  // while `edges` describe the OWN body: a child's tags come back on the child's
  // own item, so repeating them here would hand the caller the same edge twice
  // and misattribute it. The subtraction is by (type, slug): a parent whose own
  // `tagged_list` resolves to an entity a child also embeds loses that one
  // entry from the augmentation (its prose-scanned edges are untouched) — an
  // accepted imprecision, cheaper than re-resolving tagged lists per body.
  const linked = db
    .prepare(
      `SELECT l.entity_type AS type, l.entity_slug AS slug FROM section_entity_link l
        WHERE l.anchor = ?
          AND NOT EXISTS (
            SELECT 1 FROM section_entity_link d
              JOIN section_index s ON s.anchor = d.anchor AND s.rootId = d.rootId
             WHERE s.rootId = ? AND s.page_path = ? AND s.line_start > ? AND s.line_start < ?
               AND d.entity_type = l.entity_type AND d.entity_slug = l.entity_slug
          )`,
    )
    .all(section.anchor, section.rootId, section.pagePath, section.lineStart, section.lineEnd) as Array<{ type: string; slug: string }>;
  for (const row of linked) {
    const already = edges.entityEmbeds.some((e) => e.type === row.type && (e.slug === row.slug || e.slugs?.includes(row.slug)));
    if (already) continue;
    edges.entityEmbeds.push({ tagType: 'section_entity_link', type: row.type, slug: row.slug });
  }

  // 0.2.16 — collapse exact duplicates, first occurrence wins. While edges still
  // carried `raw` and `line`, two mentions of one anchor were two distinct facts
  // ("it is referenced HERE, and also HERE"). Stripped to identifiers they are
  // the same fact written twice, and a caller can act on it only once — so a
  // section that links the same page three times would spend three times the
  // budget of the truncated response these edges exist to rescue.
  return {
    sectionRefs: dedupe(edges.sectionRefs),
    entityEmbeds: dedupe(edges.entityEmbeds),
    pageLinks: dedupe(edges.pageLinks),
  };
}

/** Identity is the serialized edge — key order is fixed by the literals above. */
function dedupe<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
