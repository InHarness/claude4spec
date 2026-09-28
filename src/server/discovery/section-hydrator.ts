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
import { ownBodyOf, parseSections, type ParsedSection } from '../../shared/section-parser.js';
import type { RawSection } from './raw-entity-reader.js';
import type { SectionEdges } from './types.js';

export interface HydratedSection extends RawSection {
  body: string;
  edges: SectionEdges;
}

/**
 * A page split into lines with its sections parsed ONCE.
 *
 * Every read-side consumer of a section's own body goes through this: a
 * subtree expansion hands `get_sections` up to fifty sections of ONE file, and
 * `get_page_outline` measures every heading of a page. Parsing per section made
 * each of those quadratic in the page's heading count.
 *
 * A body is the section's OWN body — up to the next section of any level. Since
 * 2.0.0 that is also exactly what `section_index` stores (`body`, `line_end`),
 * and both come from the one shared section parser, so the read side and the
 * index cannot disagree about where a section ends. There is no
 * `includeSubtree` variant: with the flag, `get_sections` widens the SET of
 * items rather than any one item's body.
 */
export class PageLines {
  readonly lines: string[];
  private readonly byAnchor = new Map<string, ParsedSection>();

  constructor(pageContent: string, kind: 'md' | 'mdx' = 'md') {
    this.lines = pageContent.split('\n');
    for (const sec of parseSections(pageContent, kind, { frontmatter: false }).sections) {
      // First occurrence owns a duplicated anchor — the indexer's rule.
      if (sec.anchor && !this.byAnchor.has(sec.anchor)) this.byAnchor.set(sec.anchor, sec);
    }
  }

  /** The own body; '' when the file no longer carries the anchor (a stale row). */
  body(section: RawSection): string {
    const sec = this.byAnchor.get(section.anchor);
    return sec ? ownBodyOf(this.lines, sec) : '';
  }

  /** Byte size of the own body — what `get_page_outline` reports so a caller can measure before fetching. */
  size(section: RawSection): number {
    return Buffer.byteLength(this.body(section), 'utf8');
  }
}

/**
 * Hydration over a page the caller already holds. Since 0.2.102 the item
 * carries no line coordinates, so only the body and its edges are derived here.
 */
export function hydrateSectionFrom(db: Database, page: PageLines, section: RawSection): HydratedSection {
  const body = page.body(section);
  return { ...section, body, edges: parseEdges(db, section, body) };
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
  // 2.0.0 — the index derives a section's links from its OWN body, the same
  // body `edges` describe, so a child's links live on the child's row and no
  // subtraction of descendants is needed any more.
  const linked = db
    .prepare('SELECT entity_type AS type, entity_slug AS slug FROM section_entity_link WHERE anchor = ?')
    .all(section.anchor) as Array<{ type: string; slug: string }>;
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
