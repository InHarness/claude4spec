import type { DataDeclaration } from '../../plugin-host/data-schema.js';
import type { SlugPattern } from '../../plugin-host/slug-pattern.js';

/** Host API 2.0.0 — what `diagram` IS. */
export const diagramData: DataDeclaration = {
  schema: {
    /**
     * The reserved label, and `diagram`'s FIRST one — until 0.2.22 this type had
     * no name at all, so every chip, row and card showed the raw slug.
     *
     * No `computedDefault`: there is nothing honest to derive it from. `source`
     * is a DSL body, and the retired slug chain's guess at "the first identifier
     * in the source" made a passable slug but would make a poor title.
     */
    title: {
      kind: 'string',
      required: true,
      maxLength: 200,
      description: 'Label, e.g. "Checkout sequence".',
    },
    /**
     * An `enum` node, so the generic write path REJECTS an unknown format rather
     * than coercing it. The retired read path mapped every value other than
     * `'d2'` to `'mermaid'` silently, which meant a garbage format was
     * indistinguishable from a deliberate mermaid diagram. The create/update Zod
     * schemas already enumerated the two values; this is the same rule finally
     * stated once.
     */
    format: {
      kind: 'enum',
      values: ['mermaid', 'd2'],
      required: true,
      default: 'mermaid',
      description: "Diagram language (default 'mermaid').",
    },
    /**
     * The FIRST `contentBearing` field in the specification, and the reason the
     * flag was defined before anything used it.
     *
     * A diagram body is measured in kilobytes and is read by a renderer, not
     * compared field-by-field by an agent listing diagrams. So it travels in no
     * generic read — callers get `hasSource` / `sourceBytes` and the name of the
     * operation that hands it over — while still being written normally,
     * snapshotted normally, and stored verbatim in the entity file.
     */
    source: {
      kind: 'string',
      required: true,
      default: '',
      contentBearing: true,
      description:
        'DSL body (mermaid). May be empty (placeholder). Content-bearing: read it with ' +
        'get_field_content, not through get_entities.',
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/*
 * 0.2.22 removed `caption` and `firstSourceIdentifier` from this schema.
 *
 * Both existed only to feed the three-alternative slug chain, which collapsed
 * into `slugify(title)` once every type gained a title. `firstSourceIdentifier`
 * has no successor — guessing a name out of a mermaid body was always a
 * fallback, and there is nothing left to fall back FROM.
 *
 * `caption` survives OUTSIDE the entity: the create popover still asks for one,
 * and it is written as an attribute of the markdown reference
 * (`<single_element type="diagram" slug="…" caption="…"/>`). That is where it
 * always belonged — a caption describes a diagram AT A PLACE IN A DOCUMENT, and
 * the same diagram embedded twice may deserve two different ones. What changes
 * is that it no longer pretends to be a property of the entity.
 */

/**
 * One rule where there were three: `slugify(title)`, truncated.
 *
 * The retired chain ended in `diagram-<nanoid(8)>`, which meant two diagrams
 * captioned the same silently became two entities with unrelated slugs. Under
 * `slugConflict: 'reject'` the second one now fails loudly with `SLUG_CONFLICT`.
 * That is the trade the release takes deliberately: a noisy collision is better
 * than two entities nobody knows were meant to be one.
 *
 * An explicit `slug` on the create payload still wins — the write path's rule,
 * applied before a pattern is ever evaluated.
 */
export const diagramSlugPattern: SlugPattern = [
  { op: 'slugify', field: 'title' },
  { op: 'truncate', n: 60 },
];
