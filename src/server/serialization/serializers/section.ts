import type { RawSection } from '../../discovery/raw-entity-reader.js';
import type { HydratedSection } from '../../discovery/section-hydrator.js';

/**
 * A section is explicitly NOT an entity type: it is not registered with the
 * plugin host, has no entry on the `config.entities` whitelist and offers the
 * agent no CRUD. It does have a serializer, keyed by `anchor` rather than
 * `slug`, because everything that reads the spec needs one shape for "a piece
 * of a page".
 *
 * M39 turned this from a set of coordinates into the source for `get_sections`.
 * Coordinates alone were one of the three gaps the motivating session exposed:
 * an agent that had located the right section still had to go read the file
 * itself. The record now carries the BODY and the section's outgoing document
 * edges.
 *
 * The body is AS AUTHORED — XML tags untouched. A tag is an edge; expanding it
 * would paste a payload into the prose and delete the edge the reader was going
 * to follow.
 *
 * 0.2.23: ONE function, not a `ViewSet`. The three variants this file used to
 * declare — coordinates, a chip, and coordinates-plus-body — were views, and
 * views are gone. Sections were never affected by the reason views existed
 * (there is no plugin contributing section code), but they were carried by the
 * same dispatch, and leaving a one-entry view map behind would have preserved
 * the machinery for a single hard-coded caller.
 */

const coordinates = (section: RawSection) => ({
  type: 'section' as const,
  anchor: section.anchor,
  rootId: section.rootId,
  pagePath: section.pagePath,
  headingPath: section.headingPath,
  headingText: section.headingText,
  headingLevel: section.headingLevel,
  href: `/${section.pagePath}#${section.anchor}`,
  lineStart: section.lineStart,
  lineEnd: section.lineEnd,
});

/**
 * The section read record.
 *
 * Hydration (reading the page, slicing the body, parsing the edges) happens in
 * the discovery core BEFORE this is called, so this stays a pure projection. A
 * section handed here un-hydrated still serializes — it simply reports an empty
 * body and no edges, which is the honest answer for "nobody read the page".
 */
export function serializeSection(section: RawSection): Record<string, unknown> {
  const hydrated = section as Partial<HydratedSection>;
  return {
    ...coordinates(section),
    body: hydrated.body ?? '',
    edges: hydrated.edges ?? { sectionRefs: [], entityEmbeds: [], pageLinks: [] },
  };
}
