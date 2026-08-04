import type { DataDeclaration } from '../../plugin-host/data-schema.js';
import type { SlugPattern } from '../../plugin-host/slug-pattern.js';

/** Host API 2.0.0 — what `diagram` IS. */
export const diagramData: DataDeclaration = {
  schema: {
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
    source: {
      kind: 'string',
      required: true,
      default: '',
      description: 'DSL body (mermaid). May be empty (placeholder).',
    },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    /**
     * Seeds the slug and is never persisted — the declarative spelling of what
     * `diagramCreateSchema` documented in prose ("Transient — seeds the slug
     * only; NOT persisted on the entity"). No column, no snapshot entry.
     */
    caption: {
      kind: 'string',
      transientInput: true,
      description: 'Transient — seeds the slug only (slugify(caption)); NOT persisted on the entity.',
    },
    /**
     * The second fallback's source: the first identifier appearing in `source`
     * (a mermaid node id, a d2 shape name). Derived by the write path from
     * `source` immediately before the pattern is evaluated, never supplied by a
     * caller and never persisted — which is exactly what `transientInput` means.
     * Declared here because a pattern may only read fields the schema names.
     */
    firstSourceIdentifier: {
      kind: 'string',
      transientInput: true,
      /**
       * The description is load-bearing here rather than decorative: item 27
       * puts every `transientInput` field on the create schema (that is how
       * `caption` reaches the slug), and this one is host-derived. There is no
       * flag for "transient AND host-derived", so the shape admits a field a
       * caller should not send — say so where the caller reads it. Raised in
       * the same `missing` patch as the `description` slot itself.
       */
      description:
        'Derived by the write path from `source` before the slug pattern runs. Ignored if supplied.',
    },
  },
};

/**
 * The three-step fallback, unchanged in behaviour: slugify(caption) →
 * slugify(the first identifier in the source) → `diagram-<nanoid(8)>`.
 *
 * An explicit `slug` on the create payload still wins over all three — that is
 * the write path's rule, applied before a pattern is ever evaluated, not one of
 * the pattern's alternatives.
 */
export const diagramSlugPattern: SlugPattern = [
  [{ op: 'slugify', field: 'caption' }],
  [{ op: 'slugify', field: 'firstSourceIdentifier' }],
  [{ op: 'literal', value: 'diagram-' }, { op: 'nanoid', n: 8 }],
];
