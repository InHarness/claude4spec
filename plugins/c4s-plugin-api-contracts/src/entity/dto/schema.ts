import type { DataDeclaration, SlugPattern } from '@c4s/plugin-runtime';

/** Host API 2.0.0 — what `dto` IS. */
export const dtoData: DataDeclaration = {
  schema: {
    /**
     * Was `name`. A straight rename rather than an addition: a DTO's name IS its
     * label, so carrying both would be two spellings of one fact, free to drift.
     *
     * The nested `fields[].name` and `examples[].name` are untouched — those
     * name a member of a structure, not the structure.
     */
    title: {
      type: 'string',
      required: true,
      maxLength: 200,
      description: 'DTO name (PascalCase, e.g. UserResponse)',
    },
    description: { type: 'string', clearable: true },
    fields: {
      type: 'collection',
      collection: 'value',
      item: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true },
          /**
           * Deliberately WITHOUT a `ref` flag. The value is polymorphic — either
           * a primitive type name or the slug of another DTO — so a `ref` would
           * make every primitive a broken reference. A nested DTO that has been
           * renamed away therefore degrades to a consistency-check warning
           * rather than to a dangling ref the host tries to repoint.
           */
          type: { type: 'string', required: true },
          required: { type: 'boolean', required: true },
          description: { type: 'string' },
        },
      },
    },
    examples: {
      type: 'collection',
      collection: 'value',
      description: 'Named payload exemplars. Soft-validated. name unique within DTO.',
      item: {
        type: 'object',
        fields: {
          /**
           * Uniqueness within a DTO is SOFT: no `keyFields`, so no junction and
           * no UNIQUE constraint. The UI blocks a duplicate locally; the write
           * path does not, which retires the hard `EXAMPLE_NAME_CONFLICT`
           * rejection.
           */
          name: {
            type: 'string',
            required: true,
            description: 'Identifier unique within DTO (e.g. "minimal", "full", "edge-case")',
          },
          summary: { type: 'string' },
          /**
           * 0.2.9 (item 27) — was `record<string, string>`, which admitted
           * neither a number nor a nested object. An exemplar is a payload
           * "as-is": the retired hand-written schema said `z.unknown()`, and
           * `json` is that same statement made declaratively. Soft-validated
           * against `fields[]` at presentation time, never on the write path.
           */
          value: {
            type: 'json',
            description: 'Payload as-is. Soft-validated against fields[] (warning only).',
          },
        },
      },
    },
    createdAt: { type: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

/**
 * slugify(title) with PascalCase boundaries — `UserResponse` → `user-response`.
 *
 * Identical output to the retired `slugify(name)`: the rename moved the value,
 * not its content, so no existing DTO re-slugs.
 */
export const dtoSlugPattern: SlugPattern = [{ op: 'slugify', field: 'title', splitCamelCase: true }];
