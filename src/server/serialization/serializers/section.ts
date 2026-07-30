import type { RawSection } from '../../discovery/raw-entity-reader.js';
import type { HydratedSection } from '../../discovery/section-hydrator.js';
import type { EntitySerializer } from '../types.js';

/**
 * A section is explicitly NOT an entity type: it is not registered with the
 * plugin host, has no entry on the `config.entities` whitelist and offers the
 * agent no CRUD. It does have a serializer, keyed by `anchor` rather than
 * `slug`, because everything that reads the spec needs one shape for "a piece
 * of a page".
 *
 * M39 turned `detail` from a set of coordinates into the source for
 * `get_section`. Coordinates alone were one of the three gaps the motivating
 * session exposed: an agent that had located the right section still had to go
 * read the file itself. `detail` now carries the BODY and the section's
 * outgoing document edges.
 *
 * The body is AS AUTHORED — XML tags untouched. A tag is an edge; expanding it
 * would paste a payload into the prose and delete the edge the reader was going
 * to follow. `single_element` is `detail` minus body and edges, i.e. the
 * heading plus its coordinates, which is what an inline reference needs.
 */

const href = (section: RawSection) => `/${section.pagePath}#${section.anchor}`;

const coordinates = (section: RawSection) => ({
  type: 'section' as const,
  anchor: section.anchor,
  rootId: section.rootId,
  pagePath: section.pagePath,
  headingPath: section.headingPath,
  headingText: section.headingText,
  headingLevel: section.headingLevel,
  contentHash: section.contentHash,
  href: href(section),
  lineStart: section.lineStart,
  lineEnd: section.lineEnd,
});

const serializer: EntitySerializer<RawSection> = {
  type: 'section',
  version: '1.0.0',

  singleElement: (section) => coordinates(section),

  inlineMention: (section) => ({
    type: 'section',
    anchor: section.anchor,
    label: section.headingText,
    href: href(section),
  }),

  /**
   * Hydration (reading the page, slicing the body, parsing the edges) happens
   * in the discovery core BEFORE this is called, so the serializer stays a pure
   * projection and `SerializeContext` needs no new slot that every installed
   * plugin would have to compile against. A section handed here un-hydrated
   * still serializes — it simply reports an empty body and no edges, which is
   * the honest answer for "nobody read the page".
   */
  detail: (section) => {
    const hydrated = section as Partial<HydratedSection>;
    return {
      ...coordinates(section),
      body: hydrated.body ?? '',
      edges: hydrated.edges ?? { sectionRefs: [], entityEmbeds: [], pageLinks: [] },
    };
  },

  /**
   * Sections carry no tags and are not addressable by slug, so they never
   * appear in a manual `<element_list>` or a `<tagged_list>`. These exist so
   * that a caller which asks anyway gets the coordinates instead of the generic
   * `_fallback` envelope.
   */
  elementListItem: (section) => coordinates(section),
  taggedListItem: (section) => coordinates(section),
};

/**
 * M31: exported instead of attached to a singleton — every SerializationEngine
 * instance (per ProjectContext, per CLI process) receives it via constructor.
 */
export const sectionSerializer = serializer as EntitySerializer<unknown>;
