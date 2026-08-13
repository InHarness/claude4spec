import type { RawSection } from '../../discovery/raw-entity-reader.js';
import type { HydratedSection } from '../../discovery/section-hydrator.js';
import type { ViewSet } from '../types.js';

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
  href: href(section),
  lineStart: section.lineStart,
  lineEnd: section.lineEnd,
});

/**
 * 0.2.9: a `ViewSet`, not a full `SerializationContribution`. Section has no
 * manifest and therefore no `payloadVersion` — it is not an entity, it is never
 * snapshotted, and inventing a version for it would be inventing the one field
 * of the contract it cannot honestly answer.
 */
const views: ViewSet<RawSection> = {
  single_element: (section) => coordinates(section),

  inline_mention: (section) => ({
    type: 'section',
    anchor: section.anchor,
    label: section.headingText,
    href: href(section),
  }),

  /**
   * Hydration (reading the page, slicing the body, parsing the edges) happens
   * in the discovery core BEFORE this is called, so the serializer stays a pure
   * projection and the view signature needs no new slot that every installed
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
   * `element_list_item` and `tagged_list_item` are DELIBERATELY absent, and the
   * reason is domain, not cost. A section has no slug — its identity key is the
   * anchor, and it will not get one — so it can never be named in an
   * `<element_list slugs="…"/>`; it carries no tags, so it can never fall into a
   * `<tagged_list/>`. Neither list can produce a section to project.
   *
   * They used to be declared here, returning coordinates, so that a caller who
   * asked anyway got something shaped rather than the generic envelope. That
   * inverted the contract: it made the two views look supported to anyone
   * reading the registry. A caller who asks now falls through to
   * `genericSection`, which is the honest answer — this serializer does not
   * implement those views.
   */
};

/**
 * M31: exported instead of attached to a singleton — every SerializationEngine
 * instance (per ProjectContext, per CLI process) receives it via constructor.
 */
export const sectionSerializer = views as ViewSet<unknown>;
